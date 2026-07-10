# CivicFlow WordPress Theme — v1.0.0

## Installation on Hostinger
1. Log in to Hostinger hPanel
2. Go to Website → WordPress → Manage → WP Admin
3. Appearance → Themes → Add New → Upload Theme
4. Upload civicflow-theme.zip and Activate

## First-time setup

### Set homepage
Settings → Reading → Static page → select any page → Save
WordPress will use front-page.php automatically.

### Navigation menus
Appearance → Menus → create "Primary" menu, assign to Primary Navigation location.
Add custom links: #features, #platform, #pricing, #about, #contact
Add sign-in link: https://civicflow-portal-iule6.ondigitalocean.app/signup

### Customise text
Appearance → Customize → Hero Section / Demo CTA Banner / Contact Info

### Admin email for contact forms
Settings → General → Administration email address

## File structure
civicflow-theme/
  style.css           Theme header + all CSS
  functions.php       Setup, scripts, customizer, AJAX handler
  index.php           WP fallback template
  front-page.php      Homepage (assembles all sections)
  header.php          head + sticky nav
  footer.php          Footer + copyright
  js/main.js          Mobile nav, smooth scroll, form AJAX
  template-parts/
    hero.php
    stats.php
    features.php
    platform.php
    pricing.php
    about.php
    demo-cta.php
    contact.php

## Recommended plugins
- Contact Form 7     (robust form handling)
- WP Super Cache     (page caching)
- Yoast SEO          (meta/sitemaps)
- UpdraftPlus        (backups)
- Wordfence          (security)

## Support
hello@civicflowapp.com | https://docs.civicflowapp.com
