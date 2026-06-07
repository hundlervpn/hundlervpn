# Database setup

## 1) Environment variables
Use `.env.local` (local) or hosting secrets with these variables:

- `POSTGRESQL_HOST`
- `POSTGRESQL_PORT`
- `POSTGRESQL_USER`
- `POSTGRESQL_PASSWORD`
- `POSTGRESQL_DBNAME`
- `POSTGRESQL_SSL_MODE` (`disable` for private IP, `require` for domain)
- `POSTGRESQL_SSL_CA_PATH` (optional, only for SSL mode)

## 2) Schema
Schema file: `db/schema.sql`

It includes tables:

- `users`
- `plans`
- `servers`
- `subscriptions`
- `vpn_keys`
- `payments`
- `logs`

Plus indexes and `updated_at` triggers.

## 3) Apply schema manually

### Windows PowerShell + psql
```powershell
$env:PGPASSWORD = "<your_password>"
psql -h <host> -p 5432 -U gen_user -d default_db -f db/schema.sql
```

### SSL certificate mode (domain)
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.cloud-certs" | Out-Null
Invoke-WebRequest -Uri "https://st.timeweb.com/cloud-static/ca.crt" -OutFile "$HOME\.cloud-certs\root.crt"
icacls "$HOME\.cloud-certs\root.crt" /inheritance:r /grant:r "$env:USERNAME`:R"
```

Then use:

- `POSTGRESQL_SSL_MODE=require`
- `POSTGRESQL_SSL_CA_PATH=C:\Users\<username>\.cloud-certs\root.crt`
