<?php
/**
 * Page template — Downloads
 *
 * @package Unestra
 */

get_header();

$version       = '1.0.10';
$release_date  = 'July 30, 2026';
$win_file      = 'Unestra-Setup-1.0.10.exe';
$win_size      = '130.2 MB';
$win_sha256    = '1c7774d9f212b77e7881360b0eed24d2018fd017aa5119816664898292fec008';
$mac_file      = 'Unestra-1.0.10-mac-arm64.dmg';
$mac_size      = '161.4 MB';
$mac_sha256    = '81fdb3ad6c627492a83e11fdadbb05071e61cab1199413fa65ebd52ecedd5a95';
?>

<div class="dl-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3rem;max-width:640px;">
			<p class="section-label"><?php esc_html_e( 'Downloads', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'Get the Unestra desktop app', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Version ' . $version . ' — released ' . $release_date . '. Offline-first, with automatic updates.', 'civicflow' ); ?></p>
		</div>

		<div class="dl-grid">

			<!-- Windows -->
			<div class="dl-card">
				<div class="dl-platform-icon" aria-hidden="true">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.351"/></svg>
				</div>
				<h2>Windows</h2>
				<p class="dl-version">Version <?php echo esc_html( $version ); ?> &middot; <?php echo esc_html( $win_size ); ?></p>
				<a class="btn btn-primary dl-button" href="<?php echo esc_url( home_url( '/download/windows' ) ); ?>">
					<?php esc_html_e( 'Download for Windows', 'civicflow' ); ?>
				</a>
				<p class="dl-signed"><span class="dl-check" aria-hidden="true">&#10003;</span> <?php esc_html_e( 'Digitally signed installer', 'civicflow' ); ?></p>
				<ul class="dl-meta">
					<li><?php esc_html_e( 'Supported: Windows 10 and 11 (64-bit)', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'File type: .exe (NSIS installer)', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Release date: ' . $release_date, 'civicflow' ); ?></li>
				</ul>
				<details class="dl-checksum">
					<summary><?php esc_html_e( 'SHA-256 checksum', 'civicflow' ); ?></summary>
					<code><?php echo esc_html( $win_sha256 ); ?></code>
				</details>
			</div>

			<!-- macOS -->
			<div class="dl-card">
				<div class="dl-platform-icon" aria-hidden="true">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.02-2.7c.843-1.025 1.42-2.44 1.267-3.85-1.222.052-2.696.812-3.57 1.836-.78.907-1.463 2.35-1.28 3.735 1.35.104 2.74-.688 3.583-1.72z"/></svg>
				</div>
				<h2>macOS</h2>
				<p class="dl-version">Version <?php echo esc_html( $version ); ?> &middot; <?php echo esc_html( $mac_size ); ?></p>
				<a class="btn btn-primary dl-button" href="<?php echo esc_url( home_url( '/download/macos' ) ); ?>">
					<?php esc_html_e( 'Download for macOS', 'civicflow' ); ?>
				</a>
				<p class="dl-signed"><span class="dl-check" aria-hidden="true">&#10003;</span> <?php esc_html_e( 'Signed and notarized by APH Technologies', 'civicflow' ); ?></p>
				<ul class="dl-meta">
					<li><?php esc_html_e( 'Apple Silicon (M-series) only — Intel build not yet available', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'File type: .dmg', 'civicflow' ); ?></li>
					<li><?php esc_html_e( 'Release date: ' . $release_date, 'civicflow' ); ?></li>
				</ul>
				<details class="dl-checksum">
					<summary><?php esc_html_e( 'SHA-256 checksum', 'civicflow' ); ?></summary>
					<code><?php echo esc_html( $mac_sha256 ); ?></code>
				</details>
			</div>

		</div>

		<!-- Install / requirements -->
		<div class="dl-info-grid">
			<div>
				<h3><?php esc_html_e( 'Installing on Windows', 'civicflow' ); ?></h3>
				<p><?php esc_html_e( 'Run the downloaded .exe and follow the setup wizard. Unestra installs to your user profile and does not require administrator rights.', 'civicflow' ); ?></p>
			</div>
			<div>
				<h3><?php esc_html_e( 'Installing on macOS', 'civicflow' ); ?></h3>
				<p><?php esc_html_e( 'Open the .dmg, drag Unestra into Applications, then launch it from Applications or Launchpad — no extra steps needed.', 'civicflow' ); ?></p>
			</div>
			<div>
				<h3><?php esc_html_e( 'Automatic updates', 'civicflow' ); ?></h3>
				<p><?php esc_html_e( 'Once installed, Unestra checks for and applies updates automatically — no need to revisit this page for future releases.', 'civicflow' ); ?></p>
			</div>
		</div>

		<p class="dl-footer-note">
			<?php
			printf(
				/* translators: %s: release notes link */
				esc_html__( 'Looking for older versions or the full changelog? See the %s.', 'civicflow' ),
				'<a href="' . esc_url( home_url( '/releases' ) ) . '">' . esc_html__( 'release notes', 'civicflow' ) . '</a>'
			);
			?>
			<?php esc_html_e( 'Prefer the cloud? ', 'civicflow' ); ?>
			<a href="https://app.getunestra.com/signup"><?php esc_html_e( 'Sign up for Unestra Cloud', 'civicflow' ); ?></a>
			<?php esc_html_e( ' — no install required.', 'civicflow' ); ?>
		</p>
	</div>
</div>

<style>
.dl-page { padding: 4.5rem 0 5rem; background: var(--cf-bg-alt); }
.dl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.75rem; margin-bottom: 3rem; }
.dl-card { background: #fff; border: 1px solid var(--cf-border); border-radius: var(--cf-radius-lg); padding: 2.25rem; box-shadow: var(--cf-shadow); }
.dl-platform-icon { width: 56px; height: 56px; border-radius: 14px; background: var(--cf-green-light); color: var(--cf-green-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 1.25rem; }
.dl-card h2 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.35rem; }
.dl-version { color: var(--cf-text-muted); font-size: 0.92rem; margin-bottom: 1.5rem; }
.dl-button { width: 100%; justify-content: center; margin-bottom: 1rem; }
.dl-signed, .dl-unsigned { font-size: 0.85rem; display: flex; align-items: center; gap: 6px; margin-bottom: 1.25rem; }
.dl-signed { color: var(--cf-green-dark); }
.dl-unsigned { color: #92400e; }
.dl-check, .dl-warn { flex-shrink: 0; }
.dl-meta { font-size: 0.88rem; color: var(--cf-text-muted); margin-bottom: 1rem; padding-left: 0; }
.dl-meta li { margin-bottom: 0.35rem; padding-left: 1.1rem; position: relative; }
.dl-meta li::before { content: "–"; position: absolute; left: 0; }
.dl-checksum { font-size: 0.82rem; }
.dl-checksum summary { cursor: pointer; color: var(--cf-text-muted); font-weight: 500; }
.dl-checksum code { display: block; margin-top: 0.5rem; padding: 0.6rem 0.75rem; background: var(--cf-bg-alt); border-radius: var(--cf-radius-sm); word-break: break-all; font-size: 0.78rem; color: var(--cf-text); }
.dl-notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--cf-radius-lg); padding: 1.75rem 2rem; margin-bottom: 3rem; }
.dl-notice h3 { font-size: 1.05rem; margin-bottom: 0.6rem; color: #92400e; }
.dl-notice ol { padding-left: 1.3rem; margin: 0.75rem 0; }
.dl-notice li { margin-bottom: 0.35rem; }
.dl-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 2rem; margin-bottom: 2.5rem; }
.dl-info-grid h3 { font-size: 1rem; margin-bottom: 0.5rem; }
.dl-info-grid p { color: var(--cf-text-muted); font-size: 0.92rem; }
.dl-footer-note { text-align: center; color: var(--cf-text-muted); font-size: 0.92rem; }
.dl-footer-note a { color: var(--cf-green); text-decoration: underline; }
</style>

<?php get_footer(); ?>
