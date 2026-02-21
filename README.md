# page

Personal landing page, deployed on Cloudflare Pages.

## Structure

```
/
├── index.html              # Home page
├── favicon.svg
├── css/
│   ├── common.css          # Reset, variables, typography, body layout, footer
│   └── home.css            # Avatar, icon links, tagline — home-page-specific
├── js/
│   ├── common.js           # Theme-color sync (useful on every page)
│   └── home.js             # Avatar SVG inlining & polygon animation
└── img/
    ├── me.jpeg
    ├── low_poly_me.svg
    └── low_poly_me_1.svg
```

## Local preview

Open `index.html` in a browser. No build step required.

## Deploy on Cloudflare Pages

1. Connect the GitHub repository to Cloudflare Pages.
2. Leave the **build command** empty (static site, no build).
3. Set the **build output directory** to `/` (root).
