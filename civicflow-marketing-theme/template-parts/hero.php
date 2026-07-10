<?php
/**
 * Template Part: Hero Section
 *
 * @package Unestra
 */
?>
<section id="hero" aria-labelledby="hero-heading">
	<div class="container">

		<div class="hero-badge" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
			<?php echo esc_html( cf_mod( 'hero_badge', 'Built for mission-driven organizations' ) ); ?>
		</div>

		<?php
		$heading = cf_mod( 'hero_heading', 'Everything your organization needs to thrive together' );
		// Bold the last two words in green
		$words   = explode( ' ', $heading );
		$last    = array_splice( $words, -2 );
		$plain   = implode( ' ', $words );
		$green   = implode( ' ', $last );
		?>
		<h1 id="hero-heading">
			<?php echo esc_html( $plain ); ?> <span><?php echo esc_html( $green ); ?></span>
		</h1>

		<p class="hero-sub"><?php echo esc_html( cf_mod( 'hero_subtext', 'Unestra brings member management, dues, events, communications, finances, and reporting into one secure, easy-to-use platform — so you can focus on your mission, not your spreadsheets.' ) ); ?></p>

		<div class="hero-btns">
			<a href="https://app.civicflowapp.com/signup" class="btn btn-primary" target="_blank" rel="noopener">
				<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
				<?php esc_html_e( 'Start free trial', 'civicflow' ); ?>
			</a>
			<a href="<?php echo esc_url( cf_mod( 'hero_btn2_url', '#contact' ) ); ?>" class="btn btn-secondary">
				<?php echo esc_html( cf_mod( 'hero_btn2', 'Schedule a demo' ) ); ?>
				<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
			</a>
		</div>

		<!-- Feature highlights -->
		<div class="hero-screenshot" aria-hidden="true" role="presentation">
			<div class="hero-screenshot-inner">
				<div class="mock-stat">
					<div class="mock-stat-label">Members & dues</div>
					<div class="mock-stat-icon">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					</div>
				</div>
				<div class="mock-stat">
					<div class="mock-stat-label">Events & campaigns</div>
					<div class="mock-stat-icon">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
					</div>
				</div>
				<div class="mock-stat">
					<div class="mock-stat-label">Reports & finances</div>
					<div class="mock-stat-icon">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
					</div>
				</div>
			</div>
		</div>

	</div>
</section>
