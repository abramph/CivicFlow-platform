<?php
/**
 * Page template — Solutions
 *
 * @package Unestra
 */

get_header();

$solutions = [
	[
		'title' => 'Nonprofit organizations',
		'desc'  => 'Manage donors and members, track contributions, run campaigns, and report to your board — all in one place.',
		'icon'  => '<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/>',
	],
	[
		'title' => 'Community associations',
		'desc'  => 'Track dues, coordinate events, manage HOA or neighborhood association member records, and keep everyone informed.',
		'icon'  => '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
	],
	[
		'title' => 'Unions',
		'desc'  => 'Maintain member rolls, collect dues, coordinate meetings and votes, and communicate with your membership.',
		'icon'  => '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	],
	[
		'title' => 'Churches & faith-based organizations',
		'desc'  => 'Manage congregation records, track giving, coordinate events and volunteer schedules, and communicate with your community.',
		'icon'  => '<path d="M12 2v20M5 8l7-6 7 6M4 12h16M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/>',
	],
	[
		'title' => 'Cultural organizations',
		'desc'  => 'Coordinate members, events, and programming for cultural centers, heritage groups, and community arts organizations.',
		'icon'  => '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
	],
	[
		'title' => 'Alumni organizations',
		'desc'  => 'Keep alumni records current, organize reunions and events, and manage dues or giving campaigns.',
		'icon'  => '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5"/>',
	],
	[
		'title' => 'Clubs',
		'desc'  => 'Manage membership rosters, dues, events, and communications for social, hobby, or interest-based clubs.',
		'icon'  => '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
	],
	[
		'title' => 'Professional associations',
		'desc'  => 'Track member credentials, dues, continuing education events, and communications across your membership.',
		'icon'  => '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
	],
];
?>

<div class="sol-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3.5rem;max-width:680px;">
			<p class="section-label"><?php esc_html_e( 'Solutions', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'Built for membership-based organizations', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Unestra adapts to how your organization actually works — whatever kind of organization you run.', 'civicflow' ); ?></p>
		</div>

		<div class="sol-grid">
			<?php foreach ( $solutions as $s ) : ?>
				<div class="sol-card">
					<div class="sol-icon" aria-hidden="true">
						<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?php echo $s['icon']; ?></svg>
					</div>
					<h3><?php echo esc_html( $s['title'] ); ?></h3>
					<p><?php echo esc_html( $s['desc'] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>

		<div class="sol-cta">
			<h2><?php esc_html_e( 'Don\'t see your organization type?', 'civicflow' ); ?></h2>
			<p><?php esc_html_e( 'Unestra is flexible enough for most membership-based organizations. Tell us about yours.', 'civicflow' ); ?></p>
			<a class="btn btn-primary" href="<?php echo esc_url( home_url( '/support/#contact' ) ); ?>"><?php esc_html_e( 'Get in touch', 'civicflow' ); ?></a>
		</div>
	</div>
</div>

<style>
.sol-page { padding: 4.5rem 0 5rem; }
.sol-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 4rem; }
.sol-card { background: #fff; border: 1px solid var(--cf-border); border-radius: var(--cf-radius-lg); padding: 1.9rem; box-shadow: var(--cf-shadow); }
.sol-icon { width: 48px; height: 48px; border-radius: 12px; background: var(--cf-green-light); color: var(--cf-green-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 1.1rem; }
.sol-card h3 { font-size: 1.08rem; font-weight: 650; margin-bottom: 0.5rem; }
.sol-card p { font-size: 0.92rem; color: var(--cf-text-muted); line-height: 1.65; }
.sol-cta { text-align: center; background: var(--cf-bg-alt); border-radius: var(--cf-radius-lg); padding: 3rem 2rem; }
.sol-cta h2 { font-size: 1.4rem; margin-bottom: 0.6rem; }
.sol-cta p { color: var(--cf-text-muted); margin-bottom: 1.5rem; }
</style>

<?php get_footer(); ?>
