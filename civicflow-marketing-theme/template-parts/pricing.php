<?php
/**
 * Template Part: Pricing Section
 *
 * @package Unestra
 */

$check = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
$dash  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
?>
<section id="pricing" aria-labelledby="pricing-heading">
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Pricing', 'civicflow' ); ?></p>
			<h2 class="section-title" id="pricing-heading"><?php esc_html_e( 'Simple, transparent pricing', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'Cloud subscription or a one-time desktop license — every plan includes the full feature set.', 'civicflow' ); ?></p>
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

		<!-- Three-column grid: Essential | Elite | Desktop -->
		<div class="pricing-grid pricing-grid-3">

			<!-- Essential -->
			<div class="pricing-card" aria-label="<?php esc_attr_e( 'Essential cloud plan', 'civicflow' ); ?>">
				<div class="pricing-version-tag tag-cloud"><?php esc_html_e( 'Cloud', 'civicflow' ); ?></div>
				<h3><?php esc_html_e( 'Essential', 'civicflow' ); ?></h3>

				<div class="price-amount" data-monthly="49" data-annual="539">
					<span class="price-display">
						$49<span class="price-period"><?php esc_html_e( '/mo', 'civicflow' ); ?></span>
					</span>
				</div>
				<p class="price-note price-note-monthly"><?php esc_html_e( 'billed monthly', 'civicflow' ); ?></p>
				<p class="price-note price-note-annual" style="display:none;"><?php esc_html_e( '$539/year — save $49', 'civicflow' ); ?></p>

				<p class="price-desc"><?php esc_html_e( 'Everything a growing organization needs to manage members, collect dues, and run events — up to 500 member records.', 'civicflow' ); ?></p>

				<ul class="pricing-features" aria-label="<?php esc_attr_e( 'Essential plan features', 'civicflow' ); ?>">
					<li><?php echo $check; ?><?php esc_html_e( 'Up to 500 member records', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Member management & dues tracking', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Contributions & payment reconciliation', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Events, meetings & attendance', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Campaigns & advocacy tools', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Email communications & blasts', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Document management', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'PDF export & standard reports', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Role-based access & audit trails', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Automatic updates & backups', 'civicflow' ); ?></li>
					<li><?php echo $dash; ?><?php esc_html_e( 'Advanced analytics', 'civicflow' ); ?></li>
					<li><?php echo $dash; ?><?php esc_html_e( 'API access', 'civicflow' ); ?></li>
				</ul>

				<p class="price-seat-note">
					<?php esc_html_e( 'Additional seats: ', 'civicflow' ); ?>
					<span class="seat-monthly">+$8/mo each</span>
					<span class="seat-annual" style="display:none;">+$88/yr each</span>
				</p>

				<a href="https://app.getunestra.com/signup" class="pricing-btn" target="_blank" rel="noopener"><?php esc_html_e( 'Start free trial', 'civicflow' ); ?></a>
				<p class="pricing-fine"><?php esc_html_e( '30-day free trial · No credit card required', 'civicflow' ); ?></p>
			</div>

			<!-- Elite -->
			<div class="pricing-card popular" aria-label="<?php esc_attr_e( 'Elite cloud plan', 'civicflow' ); ?>">
				<div class="popular-badge"><?php esc_html_e( 'Most popular', 'civicflow' ); ?></div>
				<div class="pricing-version-tag tag-cloud"><?php esc_html_e( 'Cloud', 'civicflow' ); ?></div>
				<h3><?php esc_html_e( 'Elite', 'civicflow' ); ?></h3>

				<div class="price-amount" data-monthly="99" data-annual="1089">
					<span class="price-display">
						$99<span class="price-period"><?php esc_html_e( '/mo', 'civicflow' ); ?></span>
					</span>
				</div>
				<p class="price-note price-note-monthly"><?php esc_html_e( 'billed monthly', 'civicflow' ); ?></p>
				<p class="price-note price-note-annual" style="display:none;"><?php esc_html_e( '$1,089/year — save $99', 'civicflow' ); ?></p>

				<p class="price-desc"><?php esc_html_e( 'Unlimited members, advanced analytics, and API access — built for larger or fast-growing organizations.', 'civicflow' ); ?></p>

				<ul class="pricing-features" aria-label="<?php esc_attr_e( 'Elite plan features', 'civicflow' ); ?>">
					<li><?php echo $check; ?><?php esc_html_e( 'Unlimited member records', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Member management & dues tracking', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Contributions & payment reconciliation', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Events, meetings & attendance', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Campaigns & advocacy tools', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Email communications & blasts', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Document management', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Advanced reporting & analytics', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Role-based access & audit trails', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Automatic updates & backups', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'Advanced analytics', 'civicflow' ); ?></li>
					<li><?php echo $check; ?><?php esc_html_e( 'API access', 'civicflow' ); ?></li>
				</ul>

				<p class="price-seat-note">
					<?php esc_html_e( 'Additional seats: ', 'civicflow' ); ?>
					<span class="seat-monthly">+$5/mo each</span>
					<span class="seat-annual" style="display:none;">+$55/yr each</span>
				</p>

				<a href="https://app.getunestra.com/signup" class="pricing-btn filled" target="_blank" rel="noopener"><?php esc_html_e( 'Start free trial', 'civicflow' ); ?></a>
				<p class="pricing-fine"><?php esc_html_e( '30-day free trial · No credit card required', 'civicflow' ); ?></p>
			</div>

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
					<li><?php echo $check; ?><?php esc_html_e( 'All features — full parity with Elite', 'civicflow' ); ?></li>
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

		</div><!-- .pricing-grid -->

		<p class="pricing-footer-note">
			<?php esc_html_e( 'Need help choosing? ', 'civicflow' ); ?>
			<a href="#contact"><?php esc_html_e( 'Talk to our team', 'civicflow' ); ?></a>
			<?php esc_html_e( ' — we\'ll recommend the right fit for your organization.', 'civicflow' ); ?>
		</p>

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
			section.querySelectorAll('.seat-monthly').forEach(function (el) { el.style.display = isAnnual ? 'none' : ''; });
			section.querySelectorAll('.seat-annual').forEach(function (el) { el.style.display = isAnnual ? '' : 'none'; });
		});
	}

	btns.forEach(function (btn) {
		btn.addEventListener('click', function () { setPeriod(btn.dataset.period); });
	});
})();
</script>
