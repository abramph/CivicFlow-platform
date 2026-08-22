<?php
/**
 * Template Part: Features Section
 *
 * @package Unestra
 */

$features = [
	[
		'title' => __( 'Member management', 'civicflow' ),
		'desc'  => __( 'Maintain complete member records, track enrollment status, custom fields, and relationship history — all searchable in seconds.', 'civicflow' ),
		'icon'  => '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
	],
	[
		'title' => __( 'Dues & contributions', 'civicflow' ),
		'desc'  => __( 'Offer integrated Stripe checkout while continuing to document approved payments made through Zelle, Cash App, cash, checks, payroll deductions, and other external methods.', 'civicflow' ),
		'icon'  => '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
	],
	[
		'title' => __( 'Events & meetings', 'civicflow' ),
		'desc'  => __( 'Plan and manage events, send invites, track RSVPs, monitor attendance, and keep meeting minutes all in one place.', 'civicflow' ),
		'icon'  => '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
	],
	[
		'title' => __( 'Communications', 'civicflow' ),
		'desc'  => __( 'Send targeted emails, newsletters, and announcements to your members. Segment by role, status, or group with one click.', 'civicflow' ),
		'icon'  => '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.37 2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.98-.98a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
	],
	[
		'title' => __( 'Reporting & analytics', 'civicflow' ),
		'desc'  => __( 'Generate on-demand reports on membership, finances, attendance, and campaigns. Export to Excel or PDF for your board.', 'civicflow' ),
		'icon'  => '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
	],
	[
		'title' => __( 'Campaigns & advocacy', 'civicflow' ),
		'desc'  => __( 'Coordinate campaigns, mobilize members, track participation, and measure impact across your advocacy initiatives.', 'civicflow' ),
		'icon'  => '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
	],
	[
		'title' => __( 'Document management', 'civicflow' ),
		'desc'  => __( 'Store bylaws, meeting minutes, policies, and member documents securely with access controls and version history.', 'civicflow' ),
		'icon'  => '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
	],
	[
		'title' => __( 'Role-based security', 'civicflow' ),
		'desc'  => __( 'Define roles and permissions across your organization. Complete audit trails ensure accountability at every level.', 'civicflow' ),
		'icon'  => '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
	],
	[
		'title' => __( 'Financial oversight', 'civicflow' ),
		'desc'  => __( 'Built-in financial controls, payment reconciliation, and audit trails give your treasurer and board full visibility.', 'civicflow' ),
		'icon'  => '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
	],
];
?>
<section id="features" aria-labelledby="features-heading">
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Features', 'civicflow' ); ?></p>
			<h2 class="section-title" id="features-heading"><?php esc_html_e( 'Everything under one roof', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'No more juggling tools. Unestra handles every aspect of organizational management in one connected system.', 'civicflow' ); ?></p>
		</div>

		<div class="features-grid">
			<?php foreach ( $features as $feature ) : ?>
				<article class="feature-card">
					<div class="feature-icon" aria-hidden="true">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<?php echo $feature['icon']; // already safe SVG path data ?>
						</svg>
					</div>
					<h3><?php echo esc_html( $feature['title'] ); ?></h3>
					<p><?php echo esc_html( $feature['desc'] ); ?></p>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>
