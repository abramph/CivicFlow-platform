<?php
/**
 * Page template — Release Notes
 *
 * @package Unestra
 */

get_header();
?>

<div class="rn-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3.5rem;max-width:640px;">
			<p class="section-label"><?php esc_html_e( 'Release notes', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'What\'s new in Unestra', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Desktop application changelog, based on the actual release history.', 'civicflow' ); ?></p>
		</div>

		<div class="rn-list">

			<article class="rn-entry">
				<div class="rn-entry-head">
					<h2>Version 1.0.10</h2>
					<span class="rn-date">July 30, 2026</span>
					<span class="rn-badge rn-badge-current"><?php esc_html_e( 'Current', 'civicflow' ); ?></span>
				</div>
				<p class="rn-summary"><?php esc_html_e( 'The macOS build is now signed and notarized by APH Technologies — Unestra for Mac launches directly from Applications with no Gatekeeper warnings and no manual steps required.', 'civicflow' ); ?></p>
				<ul class="rn-changes">
					<li><?php esc_html_e( 'macOS desktop app signed with a Developer ID Application certificate and notarized by Apple', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Added a .zip build alongside the .dmg to support automatic updates on macOS', 'civicflow' ); ?></li>
				</ul>
			</article>

			<article class="rn-entry">
				<div class="rn-entry-head">
					<h2>Version 1.0.9</h2>
					<span class="rn-date">July 10, 2026</span>
				</div>
				<p class="rn-summary"><?php esc_html_e( 'The first Unestra-branded desktop release — CivicFlow is now Unestra across the application, with the app icon, display name, and all customer-facing text updated. Also includes unified multi-organization membership support and several fixes to the multi-organization switcher.', 'civicflow' ); ?></p>
				<ul class="rn-changes">
					<li><?php esc_html_e( 'Renamed the product from CivicFlow to Unestra throughout the desktop application, updated the app icon', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Added unified multi-organization membership support', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Fixed the staff shell disappearing after switching organizations from the picker', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Let the member portal organization switcher reach staff-role organizations too', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Made Cash App, Venmo, and PayPal payment method entries tappable', 'civicflow' ); ?></li>
				</ul>
			</article>

			<article class="rn-entry">
				<div class="rn-entry-head">
					<h2>Version 1.0.8</h2>
					<span class="rn-date">July 3, 2026</span>
				</div>
				<p class="rn-summary"><?php esc_html_e( 'Released under the CivicFlow name, prior to the Unestra rebrand.', 'civicflow' ); ?></p>
			</article>

			<article class="rn-entry">
				<div class="rn-entry-head">
					<h2>Version 1.0.7 and earlier</h2>
				</div>
				<p class="rn-summary"><?php esc_html_e( 'Earlier CivicFlow-branded releases, including the addition of a "Make a Payment" flow for campaigns, events, and dues in advance, a Twilio-compliant SMS opt-in system, and an expanded member web portal with shared navigation, side-menu, and inbox.', 'civicflow' ); ?></p>
			</article>

		</div>

		<p class="rn-footer-note">
			<?php esc_html_e( 'Looking for the complete, unabridged commit-level history?', 'civicflow' ); ?>
			<a href="https://github.com/abramph/CivicFlow-platform/releases" target="_blank" rel="noopener">
				<?php esc_html_e( 'View all releases on GitHub', 'civicflow' ); ?>
			</a>
		</p>

		<div class="rn-cta">
			<a class="btn btn-primary" href="<?php echo esc_url( home_url( '/downloads' ) ); ?>"><?php esc_html_e( 'Download the latest version', 'civicflow' ); ?></a>
		</div>
	</div>
</div>

<style>
.rn-page { padding: 4.5rem 0 5rem; }
.rn-list { max-width: 760px; margin: 0 auto 3rem; }
.rn-entry { padding: 2rem 0; border-bottom: 1px solid var(--cf-border); }
.rn-entry:first-child { padding-top: 0; }
.rn-entry-head { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.rn-entry-head h2 { font-size: 1.25rem; font-weight: 700; }
.rn-date { color: var(--cf-text-muted); font-size: 0.88rem; }
.rn-badge { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 999px; }
.rn-badge-current { background: var(--cf-green-light); color: var(--cf-green-dark); }
.rn-summary { color: var(--cf-text-muted); font-size: 0.96rem; line-height: 1.7; margin-bottom: 1rem; }
.rn-changes { padding-left: 1.2rem; }
.rn-changes li { font-size: 0.92rem; margin-bottom: 0.45rem; line-height: 1.6; list-style: disc; }
.rn-footer-note { text-align: center; color: var(--cf-text-muted); font-size: 0.92rem; margin-bottom: 2.5rem; }
.rn-footer-note a { color: var(--cf-green); text-decoration: underline; }
.rn-cta { text-align: center; }
</style>

<?php get_footer(); ?>
