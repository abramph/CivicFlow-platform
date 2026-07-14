<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="description" content="<?php echo esc_attr( get_bloginfo( 'description' ) ); ?>">
	<link rel="profile" href="https://gmpg.org/xfn/11">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="screen-reader-text" href="#main-content"><?php esc_html_e( 'Skip to main content', 'civicflow' ); ?></a>

<!-- ============================================================
     SITE HEADER / NAV
     ============================================================ -->
<header id="site-header" role="banner">
	<div class="container">
		<nav class="nav-inner" aria-label="<?php esc_attr_e( 'Primary navigation', 'civicflow' ); ?>">

			<!-- Logo -->
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="site-logo" rel="home" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>">
<?php $civicflow_logo_id = get_theme_mod( 'custom_logo' ); if ( $civicflow_logo_id ) { echo wp_get_attachment_image( $civicflow_logo_id, 'full', false, array( 'class' => 'site-logo-mark', 'alt' => get_bloginfo( 'name' ) ) ); } else { ?>
					<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
						<path d="M16 3C9.373 3 4 8.373 4 15c0 4.27 2.12 8.04 5.37 10.34L8 28h16l-1.37-2.66C25.88 23.04 28 19.27 28 15c0-6.627-5.373-12-12-12z" fill="#1D9E75" opacity="0.2"/>
						<path d="M16 7c-4.418 0-8 3.582-8 8 0 2.652 1.285 5 3.27 6.47L10.5 24h11l-.77-2.53C22.715 20 24 17.652 24 15c0-4.418-3.582-8-8-8z" fill="#1D9E75" opacity="0.5"/>
						<circle cx="16" cy="15" r="4" fill="#1D9E75"/>
						<path d="M13 15h6M16 12v6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
					<?php } ?>
				<?php bloginfo( 'name' ); ?>
			</a>

			<!-- Mobile toggle -->
			<button class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="primary-menu" aria-label="<?php esc_attr_e( 'Toggle navigation', 'civicflow' ); ?>">
				<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
					<line x1="3" y1="6" x2="21" y2="6"/>
					<line x1="3" y1="12" x2="21" y2="12"/>
					<line x1="3" y1="18" x2="21" y2="18"/>
				</svg>
			</button>

			<!-- Nav links -->
			<?php
			wp_nav_menu( [
				'theme_location' => 'primary',
				'menu_id'        => 'primary-menu',
				'container'      => false,
				'menu_class'     => 'nav-menu',
				'fallback_cb'    => 'civicflow_fallback_nav',
			] );
			?>

		</nav>
	</div>
</header>

<main id="main-content">
<?php

/**
 * Fallback nav when no menu is assigned.
 */
function civicflow_fallback_nav() {
	?>
	<ul class="nav-menu" id="primary-menu" role="menubar">
		<li role="none"><a href="#features" role="menuitem">Features</a></li>
		<li role="none"><a href="#platform" role="menuitem">Platform</a></li>
		<li role="none"><a href="#pricing"  role="menuitem">Pricing</a></li>
		<li role="none"><a href="#about"    role="menuitem">About</a></li>
		<li role="none"><a href="#contact"  role="menuitem">Contact</a></li>
		<li role="none"><a href="https://app.getunestra.com/signup" class="nav-cta" role="menuitem">Get started &rarr;</a></li>
	</ul>
	<?php
}
