<?php
/**
 * Template Part: Platform Section
 * Updated: Desktop card now includes download links and license portal
 *
 * @package Unestra
 */

$check = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
?>
<section id="platform" aria-labelledby="platform-heading">h
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Platform', 'civicflow' ); ?></p>
			<h2 class="section-title" id="platform-heading"><?php esc_html_e( 'Cloud or desktop — your choice', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'Unestra meets your organization where you are, with full-featured access on any device or your local network.', 'civicflow' ); ?></p>
		</div>

		<div class="platform-grid">

			<!-- Cloud -->
			<div class="platform-card featured">
				<span class="platform-tag tag-cloud"><?php esc_html_e( 'Cloud version', 'civicflow' ); ?></span>
				<h3><?php esc_html_e( 'Access from anywhere', 'civicflow' ); ?></h3>
				<p><?php esc_html_e( 'Fully hosted, always up-to-date, and accessible from any browser. Perfect for distributed teams and remote-first organizations.', 'civicflow' ); ?></p>
				<ul class="platform-features">
					<?php
					$cloud_features = [
						__( 'No software to install', 'civicflow' ),
						__( 'Automatic updates & backups', 'civicflow' ),
						__( 'Multi-user, real-time access', 'civicflow' ),
						__( 'Secure, encrypted infrastructure', 'civicflow' ),
						__( 'Mobile-friendly interface', 'civicflow' ),
					];
					foreach ( $cloud_features as $feat ) :
					?>
						<li>
							<span class="check-icon" aria-hidden="true"><?php echo $check; ?></span>
							<?php echo esc_html( $feat ); ?>
						</li>
					<?php endforeach; ?>
				</ul>
				<div style="margin-top:1.5rem;">
					<a href="https://app.civicflowapp.com/signup" class="btn btn-primary" target="_blank" rel="noopener" style="font-size:14px;padding:10px 20px;">
						<?php esc_html_e( 'Start free trial', 'civicflow' ); ?>
					</a>
				</div>
			</div>

			<!-- Desktop -->
			<div class="platform-card platform-card-desktop-full">
				<span class="platform-tag tag-desktop"><?php esc_html_e( 'Desktop version', 'civicflow' ); ?></span>
				<h3><?php esc_html_e( 'Run on your own network', 'civicflow' ); ?></h3>
				<p><?php esc_html_e( 'Install Unestra on your local server or workstation. Ideal for organizations that require local data control or offline capability.', 'civicflow' ); ?></p>
				<ul class="platform-features">
					<?php
					$desktop_features = [
						__( 'Windows & macOS (Apple Silicon)', 'civicflow' ),
						__( 'Works fully offline', 'civicflow' ),
						__( 'Local data storage & full control', 'civicflow' ),
						__( '5 seats included, add more at $99 each', 'civicflow' ),
						__( 'Perpetual license — one-time purchase', 'civicflow' ),
					];
					foreach ( $desktop_features as $feat ) :
					?>
						<li>
							<span class="check-icon" aria-hidden="true"><?php echo $check; ?></span>
							<?php echo esc_html( $feat ); ?>
						</li>
					<?php endforeach; ?>
				</ul>

				<!-- Download + license actions -->
				<div class="platform-desktop-actions">
					<p class="platform-download-label">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						<?php esc_html_e( 'Download installer', 'civicflow' ); ?>
					</p>
					<div class="platform-download-btns">
<a href="https://github.com/abramph/CivicFlow-platform/releases/download/v1.0.9/Unestra-Setup-1.0.9.exe"
   class="platform-dl-btn"
						   aria-label="<?php esc_attr_e( 'Download Unestra for Windows', 'civicflow' ); ?>">
							<?php esc_html_e( 'Windows', 'civicflow' ); ?>
						</a>
<a href="https://github.com/abramph/CivicFlow-platform/releases/download/v1.0.9/Unestra-1.0.9-mac-arm64.dmg"
   class="platform-dl-btn"
						   aria-label="<?php esc_attr_e( 'Download Unestra for macOS', 'civicflow' ); ?>">
							<?php esc_html_e( 'macOS', 'civicflow' ); ?>
						</a>
					</div>

					<a class="platform-license-btn"
					   target="_blank"
					   rel="noopener noreferrer"
					   aria-label="<?php esc_attr_e( 'Open license activation portal', 'civicflow' ); ?>">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
						<?php esc_html_e( 'Activate or manage your license', 'civicflow' ); ?>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-left:auto" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
					</a>

					<p class="platform-license-note">
						<?php esc_html_e( 'Need a license key? ', 'civicflow' ); ?>
						<a href="https://buy.stripe.com/eVqcN6cWjenL9N8afpe3e00" target="_blank" rel="noopener"><?php esc_html_e( 'Purchase here →', 'civicflow' ); ?></a>
					</p>
				</div>

			</div><!-- .platform-card -->
		</div><!-- .platform-grid -->
	</div>
</section>
