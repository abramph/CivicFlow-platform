<?php
/**
 * Unestra Theme Functions
 *
 * @package Unestra
 * @version 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/* =============================================
   THEME SETUP
   ============================================= */
function civicflow_setup() {
	load_theme_textdomain( 'civicflow', get_template_directory() . '/languages' );

	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'html5', [ 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ] );
	add_theme_support( 'customize-selective-refresh-widgets' );
	add_theme_support( 'custom-logo', [
		'height'      => 60,
		'width'       => 200,
		'flex-height' => true,
		'flex-width'  => true,
	] );

	// Navigation menus
	register_nav_menus( [
		'primary'   => __( 'Primary Navigation', 'civicflow' ),
		'footer-1'  => __( 'Footer: Product', 'civicflow' ),
		'footer-2'  => __( 'Footer: Company', 'civicflow' ),
		'footer-3'  => __( 'Footer: Legal', 'civicflow' ),
	] );
}
add_action( 'after_setup_theme', 'civicflow_setup' );

/* =============================================
   ENQUEUE SCRIPTS & STYLES
   ============================================= */
function civicflow_scripts() {
	// Google Fonts
	wp_enqueue_style(
		'civicflow-fonts',
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
		[],
		null
	);

	// Main stylesheet
	wp_enqueue_style(
		'civicflow-style',
		get_stylesheet_uri(),
		[ 'civicflow-fonts' ],
		wp_get_theme()->get( 'Version' )
	);

	// Main JS
	wp_enqueue_script(
		'civicflow-main',
		get_template_directory_uri() . '/js/main.js',
		[],
		wp_get_theme()->get( 'Version' ),
		true
	);

	// Pass AJAX URL and nonce to JS
	wp_localize_script( 'civicflow-main', 'civicflowData', [
		'ajaxUrl' => admin_url( 'admin-ajax.php' ),
		'nonce'   => wp_create_nonce( 'civicflow_contact' ),
	] );
}
add_action( 'wp_enqueue_scripts', 'civicflow_scripts' );

/* =============================================
   WIDGETS
   ============================================= */
function civicflow_widgets_init() {
	register_sidebar( [
		'name'          => __( 'Footer Widget Area', 'civicflow' ),
		'id'            => 'footer-widgets',
		'description'   => __( 'Widgets appear in the site footer.', 'civicflow' ),
		'before_widget' => '<div id="%1$s" class="widget %2$s">',
		'after_widget'  => '</div>',
		'before_title'  => '<h4 class="widget-title">',
		'after_title'   => '</h4>',
	] );
}
add_action( 'widgets_init', 'civicflow_widgets_init' );

/* =============================================
   CONTACT FORM AJAX HANDLER
   Sends via Brevo's transactional API (the same
   authenticated getunestra.com/mail.getunestra.com
   domain the main application uses) rather than raw
   PHP mail(), which has no SPF/DKIM alignment on this
   server and is likely to land in spam or be dropped.
   UNESTRA_BREVO_API_KEY is defined in wp-config.php,
   not committed to this theme's repo.
   ============================================= */
function civicflow_handle_contact() {
	check_ajax_referer( 'civicflow_contact', 'nonce' );

	$name     = sanitize_text_field( $_POST['cf_name'] ?? '' );
	$email    = sanitize_email( $_POST['cf_email'] ?? '' );
	$org      = sanitize_text_field( $_POST['cf_org'] ?? '' );
	$type     = sanitize_text_field( $_POST['cf_type'] ?? '' );
	$interest = sanitize_text_field( $_POST['cf_interest'] ?? '' );
	$message  = sanitize_textarea_field( $_POST['cf_message'] ?? '' );

	if ( empty( $name ) || ! is_email( $email ) ) {
		wp_send_json_error( [ 'message' => __( 'Please provide your name and a valid email address.', 'civicflow' ) ] );
	}

	// Rate limit: max 5 submissions per IP per hour, using a transient —
	// no extra plugin/DB table needed for a low-volume marketing contact form.
	$ip_key = 'cf_rl_' . md5( $_SERVER['REMOTE_ADDR'] ?? 'unknown' );
	$count  = (int) get_transient( $ip_key );
	if ( $count >= 5 ) {
		wp_send_json_error( [ 'message' => __( 'Too many submissions — please try again later or email us directly.', 'civicflow' ) ] );
	}
	set_transient( $ip_key, $count + 1, HOUR_IN_SECONDS );

	$text_body = sprintf(
		"New Unestra website inquiry\n\nName: %s\nEmail: %s\nOrganization: %s\nOrganization type: %s\nInterested in: %s\n\nMessage:\n%s",
		$name, $email, $org, $type, $interest, $message ?: '(none)'
	);

	$sent = false;

	if ( defined( 'UNESTRA_BREVO_API_KEY' ) && UNESTRA_BREVO_API_KEY ) {
		$response = wp_remote_post( 'https://api.brevo.com/v3/smtp/email', [
			'timeout' => 15,
			'headers' => [
				'api-key'      => UNESTRA_BREVO_API_KEY,
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
			],
			'body' => wp_json_encode( [
				'sender'    => [ 'name' => 'Unestra Website', 'email' => 'notifications@getunestra.com' ],
				'to'        => [ [ 'email' => 'support@getunestra.com', 'name' => 'Unestra Support' ] ],
				// The visitor's own address as Reply-To (never as the From/sender —
				// that would be spoofing) so a direct reply reaches them.
				'replyTo'   => [ 'email' => $email, 'name' => $name ],
				'subject'   => sprintf( 'New Unestra inquiry from %s', $name ),
				'textContent' => $text_body,
			] ),
		] );

		$sent = ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) < 300;

		if ( is_wp_error( $response ) ) {
			error_log( 'Unestra contact form Brevo error: ' . $response->get_error_message() );
		}
	} else {
		// No API key configured — fall back to PHP mail() rather than
		// silently dropping the inquiry.
		$sent = wp_mail(
			get_option( 'admin_email' ),
			sprintf( 'New Unestra inquiry from %s', $name ),
			$text_body,
			[ 'Content-Type: text/plain; charset=UTF-8', 'Reply-To: ' . $name . ' <' . $email . '>' ]
		);
	}

	if ( $sent ) {
		wp_send_json_success( [ 'message' => __( 'Thank you! We\'ll be in touch shortly.', 'civicflow' ) ] );
	} else {
		wp_send_json_error( [ 'message' => __( 'Sorry, there was an error. Please email us directly at support@getunestra.com', 'civicflow' ) ] );
	}
}
add_action( 'wp_ajax_civicflow_contact',        'civicflow_handle_contact' );
add_action( 'wp_ajax_nopriv_civicflow_contact', 'civicflow_handle_contact' );

/* =============================================
   CUSTOMIZER OPTIONS
   ============================================= */
function civicflow_customize_register( $wp_customize ) {

	// ── Hero Section ──────────────────────────────
	$wp_customize->add_section( 'civicflow_hero', [
		'title'    => __( 'Hero Section', 'civicflow' ),
		'priority' => 30,
	] );

	$hero_fields = [
		'hero_badge'    => [ 'label' => 'Hero badge text',        'default' => 'Built for mission-driven organizations' ],
		'hero_heading'  => [ 'label' => 'Hero heading',           'default' => 'Everything your organization needs to thrive together' ],
		'hero_subtext'  => [ 'label' => 'Hero subtext',           'default' => 'Unestra brings member management, dues, events, communications, finances, and reporting into one secure, easy-to-use platform — so you can focus on your mission, not your spreadsheets.' ],
		'hero_btn1'     => [ 'label' => 'Primary button label',   'default' => 'Schedule a demo' ],
		'hero_btn1_url' => [ 'label' => 'Primary button URL',     'default' => '#contact' ],
		'hero_btn2'     => [ 'label' => 'Secondary button label', 'default' => 'See pricing' ],
		'hero_btn2_url' => [ 'label' => 'Secondary button URL',   'default' => '#pricing' ],
	];

	foreach ( $hero_fields as $key => $args ) {
		$wp_customize->add_setting( $key, [ 'default' => $args['default'], 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'refresh' ] );
		$wp_customize->add_control( $key, [ 'label' => $args['label'], 'section' => 'civicflow_hero', 'type' => 'text' ] );
	}

	// ── CTA Banner ───────────────────────────────
	$wp_customize->add_section( 'civicflow_cta', [
		'title'    => __( 'Demo CTA Banner', 'civicflow' ),
		'priority' => 60,
	] );

	$cta_fields = [
		'cta_heading'    => [ 'label' => 'CTA heading',         'default' => 'See Unestra in action' ],
		'cta_subtext'    => [ 'label' => 'CTA subtext',         'default' => 'Book a free 30-minute demo and we\'ll walk you through how Unestra can work for your specific organization.' ],
		'cta_btn1'       => [ 'label' => 'Primary button',      'default' => 'Book a demo' ],
		'cta_btn1_url'   => [ 'label' => 'Primary button URL',  'default' => '#contact' ],
		'cta_btn2'       => [ 'label' => 'Secondary button',    'default' => 'Start free trial' ],
		'cta_btn2_url'   => [ 'label' => 'Secondary button URL','default' => 'https://app.getunestra.com/signup' ],
	];

	foreach ( $cta_fields as $key => $args ) {
		$wp_customize->add_setting( $key, [ 'default' => $args['default'], 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'refresh' ] );
		$wp_customize->add_control( $key, [ 'label' => $args['label'], 'section' => 'civicflow_cta', 'type' => 'text' ] );
	}

	// ── Contact Info ─────────────────────────────
	$wp_customize->add_section( 'civicflow_contact', [
		'title'    => __( 'Contact Info', 'civicflow' ),
		'priority' => 70,
	] );

	$contact_fields = [
		'contact_email'   => [ 'label' => 'Contact email',   'default' => 'support@getunestra.com' ],
		'contact_hours'   => [ 'label' => 'Support hours',   'default' => 'Mon–Fri, 9am–6pm ET' ],
	];

	foreach ( $contact_fields as $key => $args ) {
		$wp_customize->add_setting( $key, [ 'default' => $args['default'], 'sanitize_callback' => 'sanitize_text_field', 'transport' => 'refresh' ] );
		$wp_customize->add_control( $key, [ 'label' => $args['label'], 'section' => 'civicflow_contact', 'type' => 'text' ] );
	}
}
add_action( 'customize_register', 'civicflow_customize_register' );

/* =============================================
   HELPER: get customizer value with default
   ============================================= */
function cf_mod( $key, $default = '' ) {
	return get_theme_mod( $key, $default );
}

/* =============================================
   DOCUMENT TITLE
   ============================================= */
function civicflow_document_title_separator( $sep ) {
	return '·';
}
add_filter( 'document_title_separator', 'civicflow_document_title_separator' );

/* =============================================
   REMOVE EMOJI (PERFORMANCE)
   ============================================= */
function civicflow_disable_emojis() {
	remove_action( 'wp_head',             'print_emoji_detection_script', 7 );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'wp_print_styles',     'print_emoji_styles' );
	remove_action( 'admin_print_styles',  'print_emoji_styles' );
}
add_action( 'init', 'civicflow_disable_emojis' );

/* =============================================
   CLEAN UP WP HEAD
   ============================================= */
remove_action( 'wp_head', 'wlwmanifest_link' );
remove_action( 'wp_head', 'rsd_link' );
remove_action( 'wp_head', 'wp_shortlink_wp_head' );
remove_action( 'wp_head', 'wp_generator' );

/* =============================================
   SEO: META DESCRIPTION, OPEN GRAPH, CANONICAL,
   ORGANIZATION SCHEMA
   WordPress already publishes /wp-sitemap.xml natively
   since 5.5 — not disabled here. robots.txt is handled
   by WordPress's virtual robots.txt (see the filter below)
   since there's no physical robots.txt file to conflict
   with it.
   ============================================= */
function unestra_seo_meta_description() {
	if ( is_front_page() ) {
		$desc = __( 'Manage members, communications, events, forms, payments and organization activity with specialized Unestra experiences for PTAs, churches, unions and community groups.', 'civicflow' );
	} elseif ( is_singular() ) {
		$excerpt = get_the_excerpt();
		$desc = $excerpt ? wp_strip_all_tags( $excerpt ) : get_bloginfo( 'description' );
	} else {
		$desc = get_bloginfo( 'description' );
	}
	echo '<meta name="description" content="' . esc_attr( wp_trim_words( $desc, 30, '…' ) ) . '">' . "\n";
}
add_action( 'wp_head', 'unestra_seo_meta_description', 1 );

function unestra_seo_canonical_and_og() {
	$url   = is_front_page() ? home_url( '/' ) : ( is_singular() ? get_permalink() : home_url( add_query_arg( null, null ) ) );
	$title = is_front_page() ? get_bloginfo( 'name' ) . ' — ' . get_bloginfo( 'description' ) : wp_get_document_title();

	echo '<link rel="canonical" href="' . esc_url( $url ) . '">' . "\n";
	echo '<meta property="og:site_name" content="Unestra">' . "\n";
	echo '<meta property="og:type" content="website">' . "\n";
	echo '<meta property="og:title" content="' . esc_attr( $title ) . '">' . "\n";
	echo '<meta property="og:url" content="' . esc_url( $url ) . '">' . "\n";
	echo '<meta name="twitter:card" content="summary_large_image">' . "\n";

	$social_image = get_theme_mod( 'social_preview_image' );
	if ( $social_image ) {
		echo '<meta property="og:image" content="' . esc_url( $social_image ) . '">' . "\n";
		echo '<meta name="twitter:image" content="' . esc_url( $social_image ) . '">' . "\n";
	}
}
add_action( 'wp_head', 'unestra_seo_canonical_and_og', 2 );

function unestra_organization_schema() {
	if ( ! is_front_page() ) {
		return;
	}
	$schema = [
		'@context'    => 'https://schema.org',
		'@type'       => 'Organization',
		'name'        => 'Unestra',
		'url'         => home_url( '/' ),
		'logo'        => get_theme_mod( 'custom_logo' ) ? wp_get_attachment_image_url( get_theme_mod( 'custom_logo' ), 'full' ) : null,
		'parentOrganization' => [
			'@type' => 'Organization',
			'name'  => 'APH Technologies LLC',
			'url'   => 'https://aphtechgroup.com',
		],
		'sameAs' => [ 'https://app.getunestra.com' ],
	];
	echo '<script type="application/ld+json">' . wp_json_encode( array_filter( $schema ) ) . '</script>' . "\n";
}
add_action( 'wp_head', 'unestra_organization_schema', 3 );

/**
 * FAQPage structured data — mirrors the Q&A pairs in
 * template-parts/pricing-faq.php. Attached only to the dedicated /pricing/
 * page (not the homepage, which also renders the same pricing section) so
 * the FAQPage schema has exactly one canonical location, matching Google's
 * guidance against duplicating the same structured data across URLs.
 */
function unestra_pricing_faq_schema() {
	if ( ! is_page( 'pricing' ) ) {
		return;
	}
	$faqs = [
		[ 'Are members limited?', 'No. Every current Unestra plan supports unlimited members.' ],
		[ 'What is an administrative seat?', 'An administrative seat is used by an officer, staff member, leader, or other person who manages the organization. Ordinary member access does not consume an administrative seat.' ],
		[ 'Is there a free trial?', 'Yes. New organizations receive a 30-day Unestra trial. Billing begins only after the organization selects a plan and completes checkout.' ],
		[ 'Does Unestra receive our dues and donations?', 'Each organization connects its own Stripe account. Eligible collections are processed through Stripe and routed to the connected organization.' ],
		[ 'Does Unestra store card numbers?', 'No. Checkout is hosted by Stripe, and Unestra does not collect or store complete card numbers in the application.' ],
		[ 'Is Unestra a public social network?', 'No. Communication is organization-scoped and designed for private interaction between members and authorized organization staff.' ],
		[ 'Does Unestra host video meetings?', 'No. Unestra can organize meeting information and provide links to services such as Zoom or Microsoft Teams, but it does not host the video meeting itself.' ],
		[ 'What happens when the trial ends?', 'Protected organization access pauses until a current subscription is activated. Organization owners retain access to billing recovery, support, security, and required account functions.' ],
	];
	$entities = array_map(
		function ( $faq ) {
			return [
				'@type'          => 'Question',
				'name'           => $faq[0],
				'acceptedAnswer' => [ '@type' => 'Answer', 'text' => $faq[1] ],
			];
		},
		$faqs
	);
	$schema = [
		'@context'   => 'https://schema.org',
		'@type'      => 'FAQPage',
		'mainEntity' => $entities,
	];
	echo '<script type="application/ld+json">' . wp_json_encode( $schema ) . '</script>' . "\n";
}
add_action( 'wp_head', 'unestra_pricing_faq_schema', 4 );

// noindex any internal/preview query args, just in case (defense in depth —
// this theme has no staging pages today, but costs nothing to guard against).
function unestra_noindex_previews() {
	if ( is_preview() || ( isset( $_GET['preview'] ) && '1' === $_GET['preview'] ) ) {
		echo '<meta name="robots" content="noindex,nofollow">' . "\n";
	}
}
add_action( 'wp_head', 'unestra_noindex_previews', 0 );

/* =============================================
   SECURITY HEADERS
   ============================================= */
function unestra_security_headers() {
	if ( headers_sent() ) {
		return;
	}
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-Frame-Options: SAMEORIGIN' );
	header( 'Referrer-Policy: strict-origin-when-cross-origin' );
	header( 'Permissions-Policy: camera=(), microphone=(), geolocation=()' );
	// HSTS: only sent over an already-HTTPS connection, so this can never
	// downgrade a plain-HTTP visitor — it just tells browsers to always use
	// HTTPS for this host from now on. No "preload" — that's a near-
	// irreversible opt-in and shouldn't ride along with a theme deploy.
	if ( is_ssl() ) {
		header( 'Strict-Transport-Security: max-age=31536000' );
	}
}
add_action( 'send_headers', 'unestra_security_headers' );

// Harden wp-config.php-adjacent editing surface: disable the in-dashboard
// theme/plugin file editor (a common brute-force-to-RCE path if an admin
// account is ever compromised).
if ( ! defined( 'DISALLOW_FILE_EDIT' ) ) {
	define( 'DISALLOW_FILE_EDIT', true );
}

/* =============================================
   DOWNLOAD REDIRECTS
   Stable getunestra.com/download/* URLs that 302 to the
   current GitHub release asset — the actual binaries stay
   on GitHub Releases (large files, already versioned/CDN'd
   there) rather than being re-hosted through WordPress.
   Uses template_redirect (not custom rewrite rules) so this
   works immediately after an FTP deploy with no "flush
   permalinks" step required.
   ============================================= */
function unestra_download_targets() {
	$base = 'https://github.com/abramph/CivicFlow-platform/releases/download/v1.0.9/';
	return [
		'windows' => $base . 'Unestra-Setup-1.0.9.exe',
		'macos'   => $base . 'Unestra-1.0.9-mac-arm64.dmg',
	];
}

function unestra_handle_download_redirect() {
	$path = trim( parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ), '/' );
	$targets = unestra_download_targets();

	// /download/windows, /download/macos, /download/latest/windows, /download/latest/macos
	if ( preg_match( '#^download/(?:latest/)?(windows|macos)$#i', $path, $m ) ) {
		$platform = strtolower( $m[1] );
		if ( isset( $targets[ $platform ] ) ) {
			wp_redirect( $targets[ $platform ], 302 );
			exit;
		}
	}

	// Legacy CivicFlow download paths, preserved for existing bookmarks/links.
	$legacy_map = [
		'download-windows'    => 'windows',
		'download-mac'        => 'macos',
		'download-macos'      => 'macos',
		'civicflow-windows'   => 'windows',
		'civicflow-mac'       => 'macos',
	];
	if ( isset( $legacy_map[ $path ] ) ) {
		wp_redirect( $targets[ $legacy_map[ $path ] ], 302 );
		exit;
	}

	// Old bare /downloads or /setup style entry points → the new Downloads page,
	// preserving any query string (campaign/analytics params).
	if ( in_array( $path, [ 'downloads', 'setup', 'download' ], true ) && ! empty( $_SERVER['QUERY_STRING'] ) ) {
		wp_redirect( home_url( '/downloads/?' . $_SERVER['QUERY_STRING'] ), 301 );
		exit;
	}
}
add_action( 'template_redirect', 'unestra_handle_download_redirect', 1 );
