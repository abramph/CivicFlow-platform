<?php
/**
 * Template Part: Verticals Section (homepage summary)
 *
 * A compact homepage summary of the four canonical verticals — the full
 * capability lists live on /solutions/, which each card links to.
 *
 * @package Unestra
 */

$verticals = [
	'pta' => [
		'title' => __( 'PTA / PTO', 'civicflow' ),
		'desc'  => __( 'Elections, volunteer shifts, dues, and fundraising for parent organizations.', 'civicflow' ),
		'icon'  => '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
	],
	'church' => [
		'title' => __( 'Church', 'civicflow' ),
		'desc'  => __( 'Participation, communication, and voluntary giving for congregations.', 'civicflow' ),
		'icon'  => '<path d="M12 2v20M5 8l7-6 7 6M4 12h16M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/>',
	],
	'union' => [
		'title' => __( 'Union', 'civicflow' ),
		'desc'  => __( 'Representation, membership, and case support for labor organizations.', 'civicflow' ),
		'icon'  => '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	],
	'community' => [
		'title' => __( 'Community Organizations', 'civicflow' ),
		'desc'  => __( 'Associations, clubs, HOAs, and neighborhood or alumni groups.', 'civicflow' ),
		'icon'  => '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
	],
];
?>
<section id="verticals" aria-labelledby="verticals-heading">
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Solutions', 'civicflow' ); ?></p>
			<h2 class="section-title" id="verticals-heading"><?php esc_html_e( 'Specialized experiences within one platform', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'The four verticals aren\'t separate products — they\'re Unestra, tuned to how your organization actually runs.', 'civicflow' ); ?></p>
		</div>

		<div class="verticals-grid">
			<?php foreach ( $verticals as $slug => $v ) : ?>
				<a class="vertical-card" href="<?php echo esc_url( home_url( '/solutions/#' . $slug ) ); ?>">
					<div class="vertical-icon" aria-hidden="true">
						<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?php echo $v['icon']; ?></svg>
					</div>
					<h3><?php echo esc_html( $v['title'] ); ?></h3>
					<p><?php echo esc_html( $v['desc'] ); ?></p>
				</a>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<style>
#verticals { padding: 4.5rem 0; }
.verticals-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1.25rem; }
.vertical-card { display: block; background: var(--cf-bg); border: 1.5px solid var(--cf-border); border-radius: var(--cf-radius-lg); padding: 1.6rem; text-decoration: none; color: inherit; transition: border-color 0.18s, box-shadow 0.18s; }
.vertical-card:hover { border-color: var(--cf-green); box-shadow: var(--cf-shadow); }
.vertical-icon { width: 42px; height: 42px; border-radius: 10px; background: var(--cf-green-light); color: var(--cf-green-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; }
.vertical-card h3 { font-size: 1rem; font-weight: 650; margin-bottom: 0.4rem; }
.vertical-card p { font-size: 0.85rem; color: var(--cf-text-muted); line-height: 1.55; margin: 0; }
</style>
