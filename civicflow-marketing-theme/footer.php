</main><!-- #main-content -->

<!-- ============================================================
     SITE FOOTER
     ============================================================ -->
<footer id="site-footer" role="contentinfo">
	<div class="container">
		<div class="footer-grid">

			<!-- Brand -->
			<div class="footer-brand">
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="site-logo" aria-label="<?php echo esc_attr( get_bloginfo( 'name' ) ); ?>">
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
				<p><?php esc_html_e( 'The all-in-one platform for nonprofits, civic organizations, churches, associations, and community groups to manage members, finances, events, and more.', 'civicflow' ); ?></p>
			</div>

			<!-- Footer nav columns -->
			<div class="footer-col">
				<h4><?php esc_html_e( 'Product', 'civicflow' ); ?></h4>
				<?php
				wp_nav_menu( [
					'theme_location' => 'footer-1',
					'container'      => false,
					'menu_class'     => '',
					'fallback_cb'    => 'civicflow_footer_product_nav',
				] );
				?>
			</div>

			<div class="footer-col">
				<h4><?php esc_html_e( 'Company', 'civicflow' ); ?></h4>
				<?php
				wp_nav_menu( [
					'theme_location' => 'footer-2',
					'container'      => false,
					'menu_class'     => '',
					'fallback_cb'    => 'civicflow_footer_company_nav',
				] );
				?>
			</div>

			<div class="footer-col">
				<h4><?php esc_html_e( 'Legal', 'civicflow' ); ?></h4>
				<?php
				wp_nav_menu( [
					'theme_location' => 'footer-3',
					'container'      => false,
					'menu_class'     => '',
					'fallback_cb'    => 'civicflow_footer_legal_nav',
				] );
				?>
			</div>

		</div><!-- .footer-grid -->

		<div class="footer-bottom">
			<p>
				&copy; <?php echo esc_html( date( 'Y' ) ); ?>
				<?php bloginfo( 'name' ); ?> &middot;
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>">civicflowapp.com</a>
			</p>
			<p><?php esc_html_e( 'Built for organizations that build communities', 'civicflow' ); ?></p>
		</div>

	</div><!-- .container -->
</footer>

<?php wp_footer(); ?>
</body>
</html>

<?php
/* ── Fallback footer nav functions ── */

function civicflow_footer_product_nav() {
	echo '<ul>';
	$links = [
		'#features'                          => 'Features',
		'#platform'                          => 'Cloud version',
		'#platform'                          => 'Desktop version',
		'#pricing'                           => 'Pricing',
		esc_url( home_url( '/setup' ) )      => 'Setup guide',
	];
	foreach ( $links as $url => $label ) {
		echo '<li><a href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}

function civicflow_footer_company_nav() {
	echo '<ul>';
	$links = [
		'#about'                         => 'About',
		'#contact'                       => 'Contact',
		esc_url( home_url( '/blog' ) )   => 'Blog',
		'https://docs.civicflowapp.com'  => 'Documentation',
	];
	foreach ( $links as $url => $label ) {
		echo '<li><a href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}

function civicflow_footer_legal_nav() {
	echo '<ul>';
	$links = [
		esc_url( home_url( '/privacy-policy' ) ) => 'Privacy policy',
		esc_url( home_url( '/terms' ) )           => 'Terms of service',
		esc_url( home_url( '/security' ) )        => 'Security',
	];
	foreach ( $links as $url => $label ) {
		echo '<li><a href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a></li>';
	}
	echo '</ul>';
}
