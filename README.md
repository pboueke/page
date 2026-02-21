# Pedro's landing page

Static landing page made with html, js and css

## Local preview

Open `index.html` in a browser. No build step required.

## Deploy to Cloudflare Pages with Wrangler

### 1. Install Wrangler

```bash
npm install -g wrangler
```

### 2. Authenticate

```bash
wrangler login
```

This opens a browser window to log in to your Cloudflare account.

### 3. Create the Pages project (first time only)

```bash
wrangler pages project create page
```

Pick a production branch name when prompted (e.g. `main`).

### 4. Deploy

From the repository root:

```bash
wrangler pages deploy . --project-name=page
```

Wrangler uploads every file in the current directory. The site will be available at `https://page.pages.dev` (or the custom domain you configure in the Cloudflare dashboard).