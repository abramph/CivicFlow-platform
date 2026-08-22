<?php
/**
 * Template Part: About Section
 *
 * @package Unestra
 */

$points = [
	[
		'title' => __( 'Built for your organization type', 'civicflow' ),
		'desc'  => __( 'Specialized experiences for PTA/PTO organizations, churches, unions, and community groups of all sizes.', 'civicflow' ),
		'icon'  => '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
	],
	[
		'title' => __( 'Role-based security', 'civicflow' ),
		'desc'  => __( 'Role-based access controls and complete audit trails help keep your organization\'s data safe.', 'civicflow' ),
		'icon'  => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
	],
	[
		'title' => __( 'Dedicated support team', 'civicflow' ),
		'desc'  => __( 'Onboarding assistance, training resources, and live help when you need it — from a team that understands your mission.', 'civicflow' ),
		'icon'  => '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
	],
];

$dashboard_rows = [
	[
		'title' => __( 'Membership growth', 'civicflow' ),
		'sub'   => __( 'Track trends and engagement over time', 'civicflow' ),
		'icon'  => '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	],
	[
		'title' => __( 'Financial clarity', 'civicflow' ),
		'sub'   => __( 'Dues, contributions & reconciliation', 'civicflow' ),
		'icon'  => '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
	],
	[
		'title' => __( 'Events & meetings', 'civicflow' ),
		'sub'   => __( 'Attendance, agendas & minutes', 'civicflow' ),
		'icon'  => '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
	],
	[
		'title' => __( 'Secure & local', 'civicflow' ),
		'sub'   => __( 'Role-based access & audit trails', 'civicflow' ),
		'icon'  => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
	],
];
?>
<section id="about" aria-labelledby="about-heading">
	<div class="container">
		<div class="about-grid">

			<!-- Content -->
			<div class="about-content">
				<p class="section-label"><?php esc_html_e( 'About', 'civicflow' ); ?></p>
				<h2 class="section-title" id="about-heading"><?php esc_html_e( 'Built for the organizations that build communities', 'civicflow' ); ?></h2>
				<p><?php esc_html_e( 'Unestra was created to solve a real problem: PTA/PTO organizations, churches, unions, and community groups were losing time managing members across disconnected tools. We built one platform with specialized experiences for each, so leaders can focus on what matters — their people and their mission.', 'civicflow' ); ?></p>

				<div class="about-points">
					<?php foreach ( $points as $point ) : ?>
						<div class="about-point">
							<div class="about-point-icon" aria-hidden="true">
								<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<?php echo $point['icon']; ?>
								</svg>
							</div>
							<div>
								<h4><?php echo esc_html( $point['title'] ); ?></h4>
								<p><?php echo esc_html( $point['desc'] ); ?></p>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			</div>

			<!-- Visual dashboard mock -->
			<div class="about-visual" role="presentation" aria-hidden="true">
				<?php foreach ( $dashboard_rows as $row ) : ?>
					<div class="about-row">
						<div class="about-row-icon">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<?php echo $row['icon']; ?>
							</svg>
						</div>
						<div class="about-row-text">
							<strong><?php echo esc_html( $row['title'] ); ?></strong>
							<span><?php echo esc_html( $row['sub'] ); ?></span>
						</div>
					</div>
				<?php endforeach; ?>
			</div>

		</div>
	</div>
</section>
