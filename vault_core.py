"""
Vaultkeeper - core: vault encryption, TOTP (2FA) codes, password generator, CSV import.

Encryption:
  * The key is derived from the master password with Argon2id (memory-hard,
    resistant to GPU guessing attacks).
  * Data is encrypted with AES-256-GCM (encryption + integrity check).
  * The file header (KDF parameters) is bound to the ciphertext as AAD, so it
    cannot be modified without decryption failing.
Everything is stored locally in a single file. Nothing goes to the internet.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import json
import os
import secrets
import shutil
import string
import struct
import time
import uuid
from dataclasses import dataclass, field, asdict
from urllib.parse import urlparse, parse_qs, unquote

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

FORMAT_VERSION = 1
MAGIC = "TREZOR-VAULT"   # file-format marker, kept so vaults created by earlier versions still open
MAX_FILE_BYTES = 10 * 1024 * 1024   # largest attachment

# Argon2id parametri (OWASP recommendation or higher): 64 MiB of memory, 3 passes.
DEFAULT_KDF = {"name": "argon2id", "iterations": 3, "memory_kib": 65536, "lanes": 4}


class WrongPasswordError(Exception):
    """Wrong master password or corrupted file."""


class VaultFormatError(Exception):
    """The file is not a valid Vaultkeeper vault."""


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass
class Entry:
    title: str = ""
    username: str = ""
    password: str = ""
    url: str = ""
    notes: str = ""
    totp: str = ""          # base32 secret or otpauth:// URI
    type: str = "login"     # login, email, domain, server, database, wallet, card, wifi, api, license, note, other
    fields: dict = field(default_factory=dict)   # extra fields depending on type
    favorite: bool = False
    tags: list = field(default_factory=list)
    history: list = field(default_factory=list)  # [{"field": "password", "value": "...", "changed": ts}]
    attachments: list = field(default_factory=list)  # [{"id", "name", "size", "added"}] - content is in Vault.files
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)

    @classmethod
    def from_dict(cls, d: dict) -> "Entry":
        known = {f for f in cls.__dataclass_fields__}
        e = cls(**{k: v for k, v in d.items() if k in known})
        if not isinstance(e.fields, dict):
            e.fields = {}
        e.fields = {str(k): str(v) for k, v in e.fields.items()}
        if not isinstance(e.tags, list):
            e.tags = []
        if not isinstance(e.history, list):
            e.history = []
        e.history = [h for h in e.history if isinstance(h, dict) and h.get("value")]
        if not isinstance(e.attachments, list):
            e.attachments = []
        e.attachments = [a for a in e.attachments if isinstance(a, dict) and a.get("id")]
        for k in ("title", "username", "password", "url", "notes", "totp", "type"):
            v = getattr(e, k)
            setattr(e, k, "" if v is None else str(v))
        e.type = e.type or "login"
        e.favorite = bool(e.favorite)
        return e


class ConflictError(Exception):
    """Someone else changed the file on disk and it cannot be merged automatically."""


class _FileLock:
    """Simple lock file (works on network drives too) held while writing."""

    def __init__(self, path: str, timeout: float = 8.0, stale: float = 30.0):
        self.lock_path = path + ".lock"
        self.timeout = timeout
        self.stale = stale

    def __enter__(self):
        deadline = time.time() + self.timeout
        while True:
            try:
                fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.lock_path) > self.stale:
                        os.remove(self.lock_path)
                        continue
                except OSError:
                    pass
                if time.time() > deadline:
                    raise ConflictError("Someone else is saving the vault right now. Try again in a few seconds.")
                time.sleep(0.15)

    def __exit__(self, *exc):
        try:
            os.remove(self.lock_path)
        except OSError:
            pass


# --------------------------------------------------------------------------
# Cryptography
# --------------------------------------------------------------------------

def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s.encode("ascii"))


def derive_key(password: str, salt: bytes, kdf: dict) -> bytes:
    if kdf.get("name") != "argon2id":
        raise VaultFormatError("Unknown KDF: %r" % kdf.get("name"))
    return Argon2id(
        salt=salt,
        length=32,
        iterations=int(kdf["iterations"]),
        lanes=int(kdf["lanes"]),
        memory_cost=int(kdf["memory_kib"]),
    ).derive(password.encode("utf-8"))


def _header_aad(header: dict) -> bytes:
    return json.dumps(header, sort_keys=True, separators=(",", ":")).encode("utf-8")


class Vault:
    """Unlocked vault in memory.

    If several people use the same file (e.g. on a network drive), every save
    checks whether the file changed in the meantime; if it did, the changes are
    merged per entry (the newer change wins, deleted entries stay deleted).
    """

    def __init__(self, path: str, key: bytes, header: dict, entries: list[Entry],
                 deleted: dict | None = None, sig=None, files: dict | None = None):
        self.path = path
        self._key = key
        self._header = header
        self.entries = entries
        self.deleted: dict[str, float] = dict(deleted or {})
        self._sig = sig
        self.files: dict[str, str] = dict(files or {})   # attachment id -> base64 content

    # ---- helpers ----------------------------------------------------------

    def _file_sig(self):
        try:
            st = os.stat(self.path)
            return (st.st_mtime_ns, st.st_size)
        except OSError:
            return None

    @staticmethod
    def _read_doc(path: str) -> dict:
        try:
            with open(path, "r", encoding="utf-8") as f:
                doc = json.load(f)
            header = doc["header"]
            _b64d(doc["nonce"]), _b64d(doc["ciphertext"])
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise VaultFormatError("The file is not a valid vault: %s" % e) from e
        if header.get("magic") != MAGIC:
            raise VaultFormatError("The file is not a Vaultkeeper vault.")
        if header.get("version") != FORMAT_VERSION:
            raise VaultFormatError("Unsupported vault version: %r" % header.get("version"))
        return doc

    @staticmethod
    def _decrypt(doc: dict, key: bytes) -> dict:
        try:
            plain = AESGCM(key).decrypt(_b64d(doc["nonce"]), _b64d(doc["ciphertext"]), _header_aad(doc["header"]))
        except InvalidTag:
            raise WrongPasswordError("Wrong master password.") from None
        return json.loads(plain.decode("utf-8"))

    # ---- create / open -------------------------------------------

    @classmethod
    def create(cls, path: str, master_password: str, kdf: dict | None = None) -> "Vault":
        if os.path.exists(path):
            raise FileExistsError(path)
        kdf = dict(kdf or DEFAULT_KDF)
        salt = secrets.token_bytes(16)
        header = {"magic": MAGIC, "version": FORMAT_VERSION, "kdf": kdf, "salt": _b64e(salt)}
        key = derive_key(master_password, salt, kdf)
        v = cls(path, key, header, [])
        v.save()
        return v

    @classmethod
    def open(cls, path: str, master_password: str) -> "Vault":
        doc = cls._read_doc(path)
        header = doc["header"]
        key = derive_key(master_password, _b64d(header["salt"]), header["kdf"])
        return cls._from_doc(path, doc, key)

    @classmethod
    def open_with_key(cls, path: str, key: bytes, expected_salt: str | None = None) -> "Vault":
        """Open with an already derived key (Windows Hello)."""
        doc = cls._read_doc(path)
        if expected_salt is not None and doc["header"].get("salt") != expected_salt:
            raise WrongPasswordError("The master password was changed in the meantime.")
        return cls._from_doc(path, doc, key)

    @classmethod
    def _from_doc(cls, path: str, doc: dict, key: bytes) -> "Vault":
        data = cls._decrypt(doc, key)
        v = cls(path, key, doc["header"], [Entry.from_dict(e) for e in data.get("entries", [])],
                data.get("deleted", {}), files=data.get("files", {}))
        v._sig = v._file_sig()
        return v

    @property
    def key(self) -> bytes:
        return self._key

    @property
    def salt(self) -> str:
        return self._header["salt"]

    # ---- synchronization with disk ----------------------------------------

    def changed_on_disk(self) -> bool:
        return os.path.exists(self.path) and self._file_sig() != self._sig

    def _merge_from_disk(self) -> None:
        doc = self._read_doc(self.path)
        if doc["header"] != self._header:
            raise ConflictError("The vault master password was changed on another computer. "
                                "Lock and unlock the vault with the new password.")
        data = self._decrypt(doc, self._key)
        deleted = dict(data.get("deleted", {}))
        for k, ts in self.deleted.items():
            deleted[k] = max(ts, deleted.get(k, 0))
        merged: dict[str, Entry] = {}
        for e in [Entry.from_dict(x) for x in data.get("entries", [])] + self.entries:
            cur = merged.get(e.id)
            if cur is None or e.updated >= cur.updated:
                merged[e.id] = e
        self.entries = [e for e in merged.values() if deleted.get(e.id, -1) < e.updated]
        self.deleted = deleted
        self.files = {**data.get("files", {}), **self.files}

    def reload(self) -> bool:
        """Load changes made by other users. Returns True if there were changes."""
        if not self.changed_on_disk():
            return False
        self._merge_from_disk()
        self._sig = self._file_sig()
        return True

    # ---- saving ----------------------------------------------------------

    def save(self) -> None:
        folder = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(folder, exist_ok=True)
        with _FileLock(self.path):
            if self._sig is not None and self.changed_on_disk():
                self._merge_from_disk()
            # deleted entries are remembered for 180 days so merging behaves correctly
            cutoff = time.time() - 180 * 86400
            self.deleted = {k: v for k, v in self.deleted.items() if v > cutoff}
            used = {a["id"] for e in self.entries for a in e.attachments}
            self.files = {k: v for k, v in self.files.items() if k in used}
            plain = json.dumps(
                {"entries": [asdict(e) for e in self.entries], "deleted": self.deleted, "files": self.files},
                ensure_ascii=False,
            ).encode("utf-8")
            nonce = secrets.token_bytes(12)  # fresh nonce on every save
            ct = AESGCM(self._key).encrypt(nonce, plain, _header_aad(self._header))
            doc = {"header": self._header, "nonce": _b64e(nonce), "ciphertext": _b64e(ct)}
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=1)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(self.path):
                try:
                    shutil.copy2(self.path, self.path + ".bak")
                except OSError:
                    pass
            os.replace(tmp, self.path)
            self._sig = self._file_sig()

    def change_master_password(self, new_password: str) -> None:
        self.reload()
        salt = secrets.token_bytes(16)
        self._header = dict(self._header, salt=_b64e(salt), kdf=dict(DEFAULT_KDF))
        self._key = derive_key(new_password, salt, self._header["kdf"])
        self._sig = None  # deliberately rewrite the file with the new key
        self.save()
        try:
            os.remove(self.path + ".bak")  # the old .bak is encrypted with the old password
        except OSError:
            pass

    def lock(self) -> None:
        self._key = b""
        self.entries = []
        self.files = {}

    # ---- attachments ------------------------------------------------------------

    def add_file(self, entry_id: str, name: str, data: bytes) -> dict:
        e = self.get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("The file is larger than %d MB." % (MAX_FILE_BYTES // (1024 * 1024)))
        fid = uuid.uuid4().hex
        meta = {"id": fid, "name": os.path.basename(name) or "file", "size": len(data), "added": time.time()}
        self.files[fid] = _b64e(data)
        e.attachments = list(e.attachments) + [meta]
        e.updated = time.time()
        self.save()
        return meta

    def get_file(self, entry_id: str, file_id: str) -> tuple[dict, bytes]:
        e = self.get(entry_id)
        meta = next((a for a in (e.attachments if e else []) if a["id"] == file_id), None)
        if not meta or file_id not in self.files:
            raise ValueError("Attachment does not exist.")
        return meta, _b64d(self.files[file_id])

    def remove_file(self, entry_id: str, file_id: str) -> None:
        e = self.get(entry_id)
        if not e:
            raise ValueError("Entry does not exist.")
        e.attachments = [a for a in e.attachments if a["id"] != file_id]
        e.updated = time.time()
        self.save()

    # ---- working with entries --------------------------------------------------

    def get(self, entry_id: str) -> Entry | None:
        return next((e for e in self.entries if e.id == entry_id), None)

    def add(self, entry: Entry) -> None:
        self.entries.append(entry)
        self.save()

    def update(self, entry: Entry) -> None:
        entry.updated = time.time()
        for i, e in enumerate(self.entries):
            if e.id == entry.id:
                self.entries[i] = entry
                break
        else:
            self.entries.append(entry)
        self.save()

    def delete(self, entry_id: str) -> None:
        self.entries = [e for e in self.entries if e.id != entry_id]
        self.deleted[entry_id] = time.time()
        self.save()

    def search(self, query: str) -> list[Entry]:
        q = query.strip().lower()
        items = sorted(self.entries, key=lambda e: e.title.lower())
        if not q:
            return items
        return [e for e in items if q in e.title.lower() or q in e.username.lower() or q in e.url.lower()]


# --------------------------------------------------------------------------
# TOTP (RFC 6238) - 2FA codes
# --------------------------------------------------------------------------

@dataclass
class TotpParams:
    secret: bytes
    digits: int = 6
    period: int = 30
    algorithm: str = "SHA1"
    issuer: str = ""
    account: str = ""


def _b32decode(s: str) -> bytes:
    s = s.replace(" ", "").replace("-", "").upper()
    s += "=" * (-len(s) % 8)
    return base64.b32decode(s)


def parse_totp(value: str) -> TotpParams:
    """Accepts a base32 secret ('JBSW Y3DP...') or an otpauth://totp/... URI."""
    value = (value or "").strip()
    if not value:
        raise ValueError("Empty 2FA key.")
    if value.lower().startswith("otpauth://"):
        u = urlparse(value)
        if u.netloc.lower() != "totp":
            raise ValueError("Only the TOTP (time-based) type is supported.")
        q = {k.lower(): v[0] for k, v in parse_qs(u.query).items()}
        label = unquote(u.path.lstrip("/"))
        issuer, _, account = label.partition(":") if ":" in label else ("", "", label)
        algo = q.get("algorithm", "SHA1").upper()
        if algo not in ("SHA1", "SHA256", "SHA512"):
            raise ValueError("Unsupported algorithm: %s" % algo)
        return TotpParams(
            secret=_b32decode(q["secret"]),
            digits=int(q.get("digits", 6)),
            period=int(q.get("period", 30)),
            algorithm=algo,
            issuer=q.get("issuer", issuer),
            account=account,
        )
    try:
        return TotpParams(secret=_b32decode(value))
    except Exception:
        raise ValueError("The 2FA key is not valid (expected base32 or an otpauth:// link).") from None


def totp_code(value: str | TotpParams, at: float | None = None) -> tuple[str, int]:
    """Returns (code, seconds_until_expiry)."""
    p = value if isinstance(value, TotpParams) else parse_totp(value)
    now = time.time() if at is None else at
    counter = int(now // p.period)
    digest = hmac.new(p.secret, struct.pack(">Q", counter), getattr(hashlib, p.algorithm.lower())).digest()
    offset = digest[-1] & 0x0F
    num = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    code = str(num % (10 ** p.digits)).zfill(p.digits)
    remaining = p.period - int(now % p.period)
    return code, remaining


# --------------------------------------------------------------------------
# Password generator and strength estimate
# --------------------------------------------------------------------------

AMBIGUOUS = set("Il1O0o")
SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/"


def generate_password(length: int = 20, lower=True, upper=True, digits=True,
                      symbols=True, avoid_ambiguous=True) -> str:
    groups = []
    if lower:
        groups.append(string.ascii_lowercase)
    if upper:
        groups.append(string.ascii_uppercase)
    if digits:
        groups.append(string.digits)
    if symbols:
        groups.append(SYMBOLS)
    if not groups:
        raise ValueError("Select at least one character group.")
    if avoid_ambiguous:
        groups = ["".join(c for c in g if c not in AMBIGUOUS) for g in groups]
    length = max(length, len(groups))
    alphabet = "".join(groups)
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if all(any(c in g for c in pw) for g in groups):
            return pw


def password_strength(pw: str) -> tuple[int, str]:
    """Rough estimate: returns (entropy_bits, label)."""
    if not pw:
        return 0, "empty"
    pool = 0
    if any(c.islower() for c in pw):
        pool += 26
    if any(c.isupper() for c in pw):
        pool += 26
    if any(c.isdigit() for c in pw):
        pool += 10
    if any(not c.isalnum() for c in pw):
        pool += 32
    import math
    bits = int(len(pw) * math.log2(max(pool, 2)))
    if bits < 40:
        label = "weak"
    elif bits < 60:
        label = "fair"
    elif bits < 80:
        label = "good"
    else:
        label = "strong"
    return bits, label


def find_weak_and_reused(entries: list[Entry]) -> tuple[list[Entry], list[list[Entry]]]:
    weak = [e for e in entries if e.password and password_strength(e.password)[0] < 60]
    by_pw: dict[str, list[Entry]] = {}
    for e in entries:
        if e.password:
            by_pw.setdefault(e.password, []).append(e)
    reused = [group for group in by_pw.values() if len(group) > 1]
    return weak, reused


# --------------------------------------------------------------------------
# Import from CSV (1Password, Bitwarden, Chrome, KeePassXC...)
# --------------------------------------------------------------------------

_COLS = {
    "title": ("title", "name", "naziv"),
    "username": ("username", "login_username", "user", "email", "korisnik"),
    "password": ("password", "login_password", "lozinka"),
    "url": ("url", "website", "login_uri", "urls", "web site"),
    "notes": ("notes", "note", "notesplain", "beleske", "extra"),
    "totp": ("otpauth", "one-time password", "totp", "login_totp", "otp"),
    "favorite": ("favorite", "favourite", "omiljeno"),
    "tags": ("tags", "folder", "group", "grupa"),
}


def import_csv(path: str) -> list[Entry]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("The CSV file has no header row.")
        lower = {name.strip().lower(): name for name in reader.fieldnames}
        mapping = {}
        for field_name, options in _COLS.items():
            for opt in options:
                if opt in lower:
                    mapping[field_name] = lower[opt]
                    break
        if "password" not in mapping:
            raise ValueError("No password column was found in the CSV file.")
        out = []
        for row in reader:
            data = {k: (row.get(col) or "").strip() for k, col in mapping.items()}
            data["favorite"] = data.get("favorite", "").lower() in ("true", "1", "yes", "da")
            data["tags"] = [t.strip() for t in data.get("tags", "").replace(";", ",").split(",") if t.strip()]
            if not data.get("title"):
                data["title"] = urlparse(data.get("url", "")).netloc or data.get("username", "") or "(untitled)"
            out.append(Entry(**data))
        return out


def default_vault_path() -> str:
    """Windows: %APPDATA%\\Vaultkeeper. Linux: ~/.local/share/Vaultkeeper (XDG_DATA_HOME).
    A vault from the old app name (Trezor) is still found and used if the new one does not exist."""
    base = os.environ.get("APPDATA")
    if not base:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    new = os.path.join(base, "Vaultkeeper", "vaultkeeper.vault")
    old = os.path.join(base, "Trezor", "trezor.vault")
    if not os.path.exists(new) and os.path.exists(old):
        return old
    return new
