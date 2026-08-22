<?php
/**
 * Template Part: Pricing Section
 *
 * Four vertical-specific Cloud plans (PTA/PTO, Community, Church, Union) plus
 * the separate one-time Desktop license. Plan data lives in one array and is
 * looped, rather than four near-identical hardcoded blocks, so a price/seat
 * change can never drift out of sync between cards.
 *
 * @package Unestra
 */

$check = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

$cloud_plans = [
	'pta' => [
		'label'    => __( 'PTA / PTO', 'civicflow' ),
		'monthly'  => 49,
		'annual'   => 539,
		'save'     => 49,
		'approx'   => 45,
		'seats'    => 10,
		'desc'     => __( 'Built for parent organizations and school-support associations — elections, volunteers, and dues in one place.', 'civicflow' ),
		'features' => [
			__( 'Unlimited members', 'civicflow' ),
			__( 'Family & household records', 'civicflow' ),
			__( 'Announcements & private communication', 'civicflow' ),
			__( 'Events & RSVP', 'civicflow' ),
			__( 'Volunteer shifts, sign-ups & check-in', 'civicflow' ),
			__( 'Elections & secret-ballot voting', 'civicflow' ),
			__( 'Dues & fundraising', 'civicflow' ),
			__( 'Forms & QR member-information updates', 'civicflow' ),
			__( 'Meeting & attendance records', 'civicflow' ),
			__( 'Role-based officer access', 'civicflow' ),
		],
	],
	'community' => [
		'label'    => __( 'Community Organizations', 'civicflow' ),
		'monthly'  => 59,
		'annual'   => 649,
		'save'     => 59,
		'approx'   => 54,
		'seats'    => 10,
		'desc'     => __( 'For associations, clubs, HOAs, and neighborhood or alumni groups managing members and dues.', 'civicflow' ),
		'features' => [
			__( 'Unlimited members', 'civicflow' ),
			__( 'Membership management', 'civicflow' ),
			__( 'Announcements & private communication', 'civicflow' ),
			__( 'Events & attendance', 'civicflow' ),
			__( 'Dues & payment reporting', 'civicflow' ),
			__( 'Campaigns & fundraising', 'civicflow' ),
			__( 'Forms & QR member-information updates', 'civicflow' ),
			__( 'Community & HOA requests, where enabled', 'civicflow' ),
			__( 'Reports & exports', 'civicflow' ),
			__( 'Role-based administration', 'civicflow' ),
		],
	],
	'church' => [
		'label'    => __( 'Church', 'civicflow' ),
		'monthly'  => 79,
		'annual'   => 869,
		'save'     => 79,
		'approx'   => 72,
		'seats'    => 15,
		'desc'     => __( 'For congregations focused on participation, communication, and voluntary giving.', 'civicflow' ),
		'features' => [
			__( 'Unlimited members', 'civicflow' ),
			__( 'Member & household records', 'civicflow' ),
			__( 'Announcements', 'civicflow' ),
			__( 'Events & attendance', 'civicflow' ),
			__( 'Funds & contribution programs', 'civicflow' ),
			__( 'One-time & recurring giving', 'civicflow' ),
			__( 'Contribution history & statements', 'civicflow' ),
			__( 'Pledges — expressions of intent, not debt', 'civicflow' ),
			__( 'Forms & QR member-information updates', 'civicflow' ),
			__( 'Role-based ministry & administrative access', 'civicflow' ),
		],
	],
	'union' => [
		'label'    => __( 'Union', 'civicflow' ),
		'monthly'  => 129,
		'annual'   => 1419,
		'save'     => 129,
		'approx'   => 118,
		'seats'    => 15,
		'desc'     => __( 'For labor organizations focused on representation, membership, and member support.', 'civicflow' ),
		'features' => [
			__( 'Unlimited members', 'civicflow' ),
			__( 'Membership & leadership records', 'civicflow' ),
			__( 'Get Help & case-request workflows', 'civicflow' ),
			__( 'Private member-to-staff communication', 'civicflow' ),
			__( 'Case status & document support', 'civicflow' ),
			__( 'Announcements, events & meetings', 'civicflow' ),
			__( 'Attendance', 'civicflow' ),
			__( 'Steward & role-based access', 'civicflow' ),
			__( 'Dues, including payroll-checkoff support', 'civicflow' ),
			__( 'Forms & QR member-information updates', 'civicflow' ),
		],
	],
];
?>
<section id="pricing" aria-labelledby="pricing-heading">
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Pricing', 'civicflow' ); ?></p>
			<h2 class="section-title" id="pricing-heading"><?php esc_html_e( 'Simple, transparent pricing for every organization type', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'Every Unestra Cloud plan includes unlimited members. Choose the vertical built for your organization.', 'civicflow' ); ?></p>
		</div>

		<!-- Monthly / Annual toggle -->
		<div class="pricing-toggle" role="group" aria-label="<?php esc_attr_e( 'Billing period', 'civicflow' ); ?>">
			<button class="pricing-toggle-btn active" data-period="monthly" aria-pressed="true">
				<?php esc_html_e( 'Monthly', 'civicflow' ); ?>
			</button>
			<button class="pricing-toggle-btn" data-period="annual" aria-pressed="false">
				<?php esc_html_e( 'Annual', 'civicflow' ); ?>
				<span class="pricing-save-badge"><?php esc_html_e( 'Save 1 month', 'civicflow' ); ?></span>
			</button>
		</div>

		<!-- Four vertical-specific Cloud plans -->
		<div class="pricing-grid pricing-grid-4">
			<?php foreach ( $cloud_plans as $slug => $plan ) : ?>
				<div class="pricing-card" aria-label="<?php echo esc_attr( sprintf( /* translators: %s: vertical name */ __( '%s plan', 'civicflow' ), $plan['label'] ) ); ?>">
					<div class="pricing-version-tag tag-cloud"><?php esc_html_e( 'Cloud', 'civicflow' ); ?></div>
					<h3><?php echo esc_html( $plan['label'] ); ?></h3>

					<div class="price-amount" data-monthly="<?php echo esc_attr( $plan['monthly'] ); ?>" data-annual="<?php echo esc_attr( $plan['annual'] ); ?>">
						<span class="price-display">
							$<?php echo esc_html( $plan['monthly'] ); ?><span class="price-period"><?php esc_html_e( '/mo', 'civicflow' ); ?></span>
						</span>
					</div>
					<p class="price-note price-note-monthly"><?php esc_html_e( 'billed monthly', 'civicflow' ); ?></p>
					<p class="price-note price-note-annual" style="display:none;">
						<?php
						echo esc_html(
							sprintf(
								/* translators: 1: annual price, 2: savings amount */
								__( '$%1$s/year — save $%2$s', 'civicflow' ),
								number_format( $plan['annual'] ),
								$plan['save']
							)
						);
						?>
					</p>

					<p class="price-desc"><?php echo esc_html( $plan['desc'] ); ?></p>

					<ul class="pricing-features" aria-label="<?php echo esc_attr( sprintf( /* translators: %s: vertical name */ __( '%s plan features', 'civicflow' ), $plan['label'] ) ); ?>">
						<?php foreach ( $plan['features'] as $feature ) : ?>
							<li><?php echo $check; ?><?php echo esc_html( $feature ); ?></li>
						<?php endforeach; ?>
					</ul>

					<p class="price-seat-note">
						<?php
						echo esc_html(
							sprintf(
								/* translators: %d: number of included administrative seats */
								__( '%d administrative seats included', 'civicflow' ),
								$plan['seats']
							)
						);
						?>
					</p>

					<a href="https://app.getunestra.com/signup" class="pricing-btn filled" target="_blank" rel="noopener"><?php esc_html_e( 'Start free trial', 'civicflow' ); ?></a>
					<p class="pricing-fine"><?php esc_html_e( '30-day free trial · No credit card required', 'civicflow' ); ?></p>
				</div>
			<?php endforeach; ?>
		</div><!-- .pricing-grid -->

		<!-- Administrative seats explainer -->
		<p class="pricing-seats-explainer">
			<?php esc_html_e( 'Administrative seats are for officers, staff, leaders, and other users who manage the organization. Ordinary members can access their member experience without consuming an administrative seat.', 'civicflow' ); ?>
			<br>
			<?php esc_html_e( 'Need additional administrative access or a more complex organization structure? ', 'civicflow' ); ?>
			<a href="#contact"><?php esc_html_e( 'Contact us to discuss your needs.', 'civicflow' ); ?></a>
		</p>

		<!-- Stripe / payment explanation -->
		<p class="pricing-seats-explainer">
			<?php esc_html_e( 'Payments are completed through Stripe-hosted checkout. Each organization connects its own Stripe account so eligible collections — dues, donations, event payments — are routed directly to the organization. Unestra does not collect or store complete card numbers in the app.', 'civicflow' ); ?>
		</p>

		<!-- Desktop license — separate, one-time product -->
		<div class="section-header" style="margin-top:3.5rem;">
			<p class="section-label"><?php esc_html_e( 'Prefer to self-host?', 'civicflow' ); ?></p>
			<h3 class="section-title" style="font-size:1.4rem;"><?php esc_html_e( 'One-time desktop license', 'civicflow' ); ?></h3>
		</div>
		<div class="pricing-grid pricing-grid-desktop-solo">

			<!-- Desktop -->
			<div class="pricing-card pricing-card-desktop" aria-label="<?php esc_attr_e( 'Desktop license plan', 'civicflow' ); ?>">
				<div class="pricing-version-tag tag-desktop"><?php esc_html_e( 'Desktop', 'civicflow' ); ?></div>
				<h3><?php esc_html_e( 'Professional', 'civicflow' ); ?></h3>

				<div class="price-amount price-amount-desktop">
					$599<span class="price-period-lg"><?php esc_html_e( ' one-time', 'civicflow' ); ?></span>
				</div>
				<p class="price-note"><?php esc_html_e( '5 seats included · Windows & macOS', 'civicflow' ); ?></p>

				<p class="price-desc"><?php esc_html_e( 'Install on your own workstation or server. Full feature access with no internet dependency for day-to-day use.', 'civicflow' ); ?></p>

				<!-- Seat add-on -->
				<div class="maintenance-block" style="margin-bottom:0.75rem;">
					<div class="maintenance-label">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
						<?php esc_html_e( 'Additional seats', 'civicflow' ); ?>
					</div>
					<div class="maintenance-price">$99<span><?php esc_html_e( '/seat', 'civicflow' ); ?></span></div>
					<p class="maintenance-desc"><?php esc_html_e( 'One-time purchase per seat. Add more users at any time.', 'civicflow' ); ?></p>
				</div>

				<!-- Annual maintenance -->
				<div class="maintenance-block">
					<div class="maintenance-label">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
						<?php esc_html_e( 'Annual maintenance', 'civicflow' ); ?>
					</div>
					<div class="maintenance-price">$199<span><?php esc_html_e( '/year', 'civicflow' ); ?></span></div>
					<p class="maintenance-desc"><?php esc_html_e( 'Optional. Includes updates, patches, and priority support.', 'civicflow' ); ?></p>
				</div>

				<ul class="pricing-features" aria-label="<?php esc_attr_e( 'Desktop plan features', 'civicflow' ); ?>">
					<li><?php echo $check; ?><?php esc_html_e( 'All features — full parity with Cloud plans', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Works fully offline', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Local data storage & full control', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( '5 user seats included', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Perpetual license — yours to keep', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Windows & macOS', 'civicflow' ); ?></li>
				</ul>

				<div class="desktop-actions">
<a href="<?php echo esc_url( home_url( '/download/windows' ) ); ?>"
   class="pricing-btn desktop-btn-download">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						<?php esc_html_e( 'Download for Windows', 'civicflow' ); ?>
					</a>
<a href="<?php echo esc_url( home_url( '/download/macos' ) ); ?>"
   class="pricing-btn desktop-btn-download">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						<?php esc_html_e( 'Download for macOS', 'civicflow' ); ?>
					</a>
					<a href="https://buy.stripe.com/eVqcN6cWjenL9N8afpe3e00" class="pricing-btn desktop-btn-license" target="_blank" rel="noopener">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
						<?php esc_html_e( 'Buy license — $599', 'civicflow' ); ?>
					</a>
				</div>

				<p class="pricing-fine"><?php esc_html_e( '30-day free trial — no credit card required', 'civicflow' ); ?></p>

				<p class="pricing-fine">
					<?php esc_html_e( 'Already purchased? ', 'civicflow' ); ?>
					<a href="https://api.civicflowapp.com/admin" target="_blank" rel="noopener"><?php esc_html_e( 'Activate your license →', 'civicflow' ); ?></a>
				</p>
			</div>

		</div><!-- .pricing-grid-desktop-solo -->

		<p class="pricing-footer-note">
			<?php esc_html_e( 'Need help choosing? ', 'civicflow' ); ?>
			<a href="#contact"><?php esc_html_e( 'Talk to our team', 'civicflow' ); ?></a>
			<?php esc_html_e( ' — we\'ll recommend the right fit for your organization.', 'civicflow' ); ?>
		</p>

		<?php get_template_part( 'template-parts/pricing-faq' ); ?>

	</div>
</section>

<script>
(function () {
	var btns   = document.querySelectorAll('.pricing-toggle-btn');
	var cards  = document.querySelectorAll('.pricing-grid [data-monthly]');

	function setPeriod(period) {
		var isAnnual = period === 'annual';

		btns.forEach(function (b) {
			var active = b.dataset.period === period;
			b.classList.toggle('active', active);
			b.setAttribute('aria-pressed', active ? 'true' : 'false');
		});

		cards.forEach(function (card) {
			var monthly = card.dataset.monthly;
			var annual  = card.dataset.annual;
			var display = card.querySelector('.price-display');
			var period_el = display ? display.querySelector('.price-period') : null;

			if (display && period_el) {
				if (isAnnual) {
					display.childNodes[0].textContent = '$' + Number(annual).toLocaleString();
					period_el.textContent = '/yr';
				} else {
					display.childNodes[0].textContent = '$' + monthly;
					period_el.textContent = '/mo';
				}
			}

			var section = card.closest('.pricing-card');
			if (!section) return;
			section.querySelectorAll('.price-note-monthly').forEach(function (el) { el.style.display = isAnnual ? 'none' : ''; });
			section.querySelectorAll('.price-note-annual').forEach(function (el) { el.style.display = isAnnual ? '' : 'none'; });
		});
	}

	btns.forEach(function (btn) {
		btn.addEventListener('click', function () { setPeriod(btn.dataset.period); });
	});
})();
</script>
