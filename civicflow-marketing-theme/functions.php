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
   (Fallback if Contact Form 7 not installed)
   ============================================= */
function civicflow_handle_contact() {
	check_ajax_referer( 'civicflow_contact', 'nonce' );

	$name    = sanitize_text_field( $_POST['cf_name'] ?? '' );
	$email   = sanitize_email( $_POST['cf_email'] ?? '' );
	$org     = sanitize_text_field( $_POST['cf_org'] ?? '' );
	$type    = sanitize_text_field( $_POST['cf_type'] ?? '' );
	$interest = sanitize_text_field( $_POST['cf_interest'] ?? '' );
	$message = sanitize_textarea_field( $_POST['cf_message'] ?? '' );

	if ( empty( $name ) || ! is_email( $email ) ) {
		wp_send_json_error( [ 'message' => __( 'Please provide your name and a valid email address.', 'civicflow' ) ] );
	}

	$to      = get_option( 'admin_email' );
	$subject = sprintf( __( 'New Unestra inquiry from %s', 'civicflow' ), $name );
	$body    = sprintf(
		"Name: %s\nEmail: %s\nOrganization: %s\nType: %s\nInterest: %s\n\nMessage:\n%s",
		$name, $email, $org, $type, $interest, $message
	);
	$headers = [
		'Content-Type: text/plain; charset=UTF-8',
		'Reply-To: ' . $name . ' <' . $email . '>',
	];

	$sent = wp_mail( $to, $subject, $body, $headers );

	if ( $sent ) {
		wp_send_json_success( [ 'message' => __( 'Thank you! We\'ll be in touch shortly.', 'civicflow' ) ] );
	} else {
		wp_send_json_error( [ 'message' => __( 'Sorry, there was an error. Please email us directly at hello@civicflowapp.com', 'civicflow' ) ] );
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
		'cta_btn2_url'   => [ 'label' => 'Secondary button URL','default' => 'https://app.civicflowapp.com/signup' ],
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
		'contact_email'   => [ 'label' => 'Contact email',   'default' => 'hello@civicflowapp.com' ],
		'contact_phone'   => [ 'label' => 'Contact phone',   'default' => '1-800-UNESTRA' ],
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
