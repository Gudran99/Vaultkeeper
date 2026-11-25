// Entry types: icon, color and the fields that are shown.
// Keys without a prefix are core fields (username, password, url, totp),
// "f:name" are extra fields stored in entry.fields.
// Field options: secret (hidden), multiline, gen (generator), url, totp, date, mono, seed, cardnum
const TYPES = {
  login: {
    label: "Web login", plural: "Web logins", icon: "user", color: "#4f8cff",
    fields: [
      { k: "username", label: "Username / email" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "url", label: "Login link", url: true, ph: "https://..." },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
  email: {
    label: "Email account", plural: "Email accounts", icon: "mail", color: "#a78bfa",
    fields: [
      { k: "username", label: "Email address", ph: "name@company.com" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "url", label: "Webmail link", url: true, ph: "https://mail..." },
      { k: "f:imap", label: "IMAP server", mono: true, ph: "imap.company.com:993" },
      { k: "f:smtp", label: "SMTP server", mono: true, ph: "smtp.company.com:587" },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
  domain: {
    label: "Domain / hosting", plural: "Domains & hosting", icon: "globe", color: "#22d3ee", sub: "f:domain",
    fields: [
      { k: "f:domain", label: "Domain", mono: true, ph: "company.com" },
      { k: "url", label: "Panel (registrar / hosting)", url: true, ph: "https://..." },
      { k: "username", label: "Username" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "f:expires", label: "Expires", date: true },
      { k: "f:nameservers", label: "DNS servers", mono: true, multiline: true },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
  server: {
    label: "Server / SSH", plural: "Servers", icon: "server", color: "#f97316", sub: "f:host",
    fields: [
      { k: "f:host", label: "Host / IP address", mono: true, ph: "10.0.0.5" },
      { k: "f:port", label: "Port", mono: true, ph: "22" },
      { k: "username", label: "User", mono: true, ph: "root" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "f:privkey", label: "Private key", secret: true, multiline: true, mono: true },
      { k: "url", label: "Panel link", url: true },
    ],
  },
  database: {
    label: "Database", plural: "Databases", icon: "database", color: "#14b8a6", sub: "f:host",
    fields: [
      { k: "f:dbtype", label: "Database type", ph: "PostgreSQL, MySQL, MSSQL…" },
      { k: "f:host", label: "Host", mono: true },
      { k: "f:port", label: "Port", mono: true },
      { k: "f:dbname", label: "Database name", mono: true },
      { k: "username", label: "User", mono: true },
      { k: "password", label: "Password", secret: true, gen: true },
    ],
  },
  wallet: {
    label: "Crypto wallet", plural: "Crypto wallets", icon: "wallet", color: "#f59e0b", sub: "f:network",
    fields: [
      { k: "f:network", label: "Network / coin", ph: "Bitcoin, Ethereum, USDT (TRC20)…" },
      { k: "f:address", label: "Wallet address", mono: true },
      { k: "f:seed", label: "Seed phrase (recovery)", secret: true, multiline: true, seed: true },
      { k: "password", label: "Password / PIN", secret: true },
      { k: "url", label: "Link (exchange / wallet)", url: true },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
  card: {
    label: "Bank card", plural: "Cards", icon: "card", color: "#ec4899", sub: "f:bank",
    fields: [
      { k: "f:holder", label: "Name on card" },
      { k: "f:number", label: "Card number", secret: true, mono: true, cardnum: true },
      { k: "f:expiry", label: "Valid thru", mono: true, ph: "MM/YY" },
      { k: "f:cvv", label: "CVV", secret: true, mono: true },
      { k: "f:pin", label: "PIN", secret: true, mono: true },
      { k: "f:bank", label: "Bank" },
    ],
  },
  bank: {
    label: "E-banking", plural: "E-banking", icon: "bank", color: "#10b981", sub: "f:bank",
    fields: [
      { k: "f:bank", label: "Bank" },
      { k: "f:iban", label: "Account number / IBAN", mono: true },
      { k: "username", label: "Username" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "url", label: "Login link", url: true },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
  wifi: {
    label: "WiFi network", plural: "WiFi networks", icon: "wifi", color: "#22c55e", sub: "f:ssid",
    fields: [
      { k: "f:ssid", label: "Network name (SSID)" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "f:security", label: "Security", ph: "WPA2 / WPA3" },
    ],
  },
  api: {
    label: "API key", plural: "API keys", icon: "key", color: "#6366f1", sub: "f:service",
    fields: [
      { k: "f:service", label: "Service" },
      { k: "f:key", label: "API key", secret: true, mono: true },
      { k: "f:secret", label: "Secret", secret: true, mono: true },
      { k: "url", label: "Console / documentation", url: true },
    ],
  },
  license: {
    label: "Software license", plural: "Licenses", icon: "license", color: "#84cc16", sub: "f:product",
    fields: [
      { k: "f:product", label: "Product" },
      { k: "f:key", label: "License key", secret: true, mono: true },
      { k: "username", label: "Registered to" },
      { k: "f:expires", label: "Expires", date: true },
      { k: "url", label: "Link", url: true },
    ],
  },
  note: {
    label: "Secure note", plural: "Notes", icon: "note", color: "#eab308",
    fields: [],
  },
  other: {
    label: "Other", plural: "Other", icon: "box", color: "#94a3b8",
    fields: [
      { k: "username", label: "Username" },
      { k: "password", label: "Password", secret: true, gen: true },
      { k: "url", label: "Link", url: true },
      { k: "totp", label: "2FA key", totp: true },
    ],
  },
};
const TYPE_ORDER = ["login", "email", "domain", "server", "database", "wallet", "card", "bank", "wifi", "api", "license", "note", "other"];
