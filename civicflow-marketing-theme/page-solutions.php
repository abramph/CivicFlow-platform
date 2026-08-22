<?php
/**
 * Page template — Solutions
 *
 * The four canonical Unestra verticals — specialized experiences within one
 * platform, not four unrelated products.
 *
 * @package Unestra
 */

get_header();

$solutions = [
	'pta' => [
		'title' => __( 'PTA / PTO', 'civicflow' ),
		'desc'  => __( 'Built for parent-teacher associations, school-support groups, and volunteer-led parent organizations.', 'civicflow' ),
		'icon'  => '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
		'caps'  => [
			__( 'Family and member management', 'civicflow' ),
			__( 'Announcements and private organization communication', 'civicflow' ),
			__( 'Events and RSVP', 'civicflow' ),
			__( 'Volunteer opportunities, shifts, and check-in', 'civicflow' ),
			__( 'Elections and secret-ballot workflows', 'civicflow' ),
			__( 'Dues and fundraising', 'civicflow' ),
			__( 'Forms and QR member-information updates', 'civicflow' ),
			__( 'Meeting and attendance records', 'civicflow' ),
			__( 'Role-based officer access', 'civicflow' ),
			__( 'Reports and exports', 'civicflow' ),
		],
		'payments' => __( 'Whether dues arrive through Stripe checkout, cash, check, Zelle, Cash App, or another approved method, Unestra helps your PTA/PTO keep a clear record — external payments can be reported for staff to confirm.', 'civicflow' ),
	],
	'church' => [
		'title' => __( 'Church', 'civicflow' ),
		'desc'  => __( 'Built around participation, communication, and voluntary giving for congregations of every size.', 'civicflow' ),
		'icon'  => '<path d="M12 2v20M5 8l7-6 7 6M4 12h16M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8"/>',
		'caps'  => [
			__( 'Member and household records', 'civicflow' ),
			__( 'Announcements', 'civicflow' ),
			__( 'Events and attendance', 'civicflow' ),
			__( 'Funds and contribution programs', 'civicflow' ),
			__( 'One-time and recurring giving', 'civicflow' ),
			__( 'Voluntary processing-cost coverage', 'civicflow' ),
			__( 'Contribution history and statements', 'civicflow' ),
			__( 'Pledges — an expression of intent, not a debt', 'civicflow' ),
			__( 'Forms and QR information updates', 'civicflow' ),
			__( 'Role-based ministry and administrative access', 'civicflow' ),
		],
		'payments' => __( 'Accept one-time and recurring giving through Stripe-hosted checkout, plus cash, check, and gifts made externally through organization-approved services. External gifts are documented, not automatically synced — your team confirms them before they\'re recorded.', 'civicflow' ),
	],
	'union' => [
		'title' => __( 'Union', 'civicflow' ),
		'desc'  => __( 'Built around representation, membership, and member support — not dues collection alone.', 'civicflow' ),
		'icon'  => '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
		'caps'  => [
			__( 'Membership and leadership records', 'civicflow' ),
			__( 'Get Help and case-request workflows', 'civicflow' ),
			__( 'Private member-to-staff communication', 'civicflow' ),
			__( 'Case status and document support', 'civicflow' ),
			__( 'Announcements', 'civicflow' ),
			__( 'Events and meetings', 'civicflow' ),
			__( 'Attendance', 'civicflow' ),
			__( 'Steward and role-based access', 'civicflow' ),
			__( 'Dues records, including payroll-checkoff support', 'civicflow' ),
			__( 'Forms and QR member-information updates', 'civicflow' ),
			__( 'Reports and exports', 'civicflow' ),
		],
		'payments' => __( 'Whether dues arrive through payroll deduction, Stripe checkout, check, cash, Zelle, Cash App, or another approved method, Unestra helps authorized union staff maintain a clear dues record. Payroll-checkoff dues come in through your existing payroll file, not entered one payment at a time.', 'civicflow' ),
	],
	'community' => [
		'title' => __( 'Community Organizations', 'civicflow' ),
		'desc'  => __( 'Built for associations, clubs, HOAs, neighborhood groups, alumni groups, and other membership organizations.', 'civicflow' ),
		'icon'  => '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
		'caps'  => [
			__( 'Unlimited member records', 'civicflow' ),
			__( 'Membership management', 'civicflow' ),
			__( 'Announcements and private communication', 'civicflow' ),
			__( 'Events and attendance', 'civicflow' ),
			__( 'Dues and payment reporting', 'civicflow' ),
			__( 'Campaigns and fundraising', 'civicflow' ),
			__( 'Forms and QR member updates', 'civicflow' ),
			__( 'Community and HOA requests, where enabled', 'civicflow' ),
			__( 'Reports and exports', 'civicflow' ),
			__( 'Role-based administration', 'civicflow' ),
		],
		'payments' => __( 'Use integrated Stripe checkout for online dues and payments, and document the external methods — cash, check, Zelle, Cash App, or others — your organization already accepts.', 'civicflow' ),
	],
];
?>

<div class="sol-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3.5rem;max-width:680px;">
			<p class="section-label"><?php esc_html_e( 'Solutions', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'One platform. Built around your organization.', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Unestra is one organization-management platform with specialized experiences for PTA/PTO organizations, churches, unions, and community organizations.', 'civicflow' ); ?></p>
		</div>

		<div class="sol-grid">
			<?php foreach ( $solutions as $slug => $s ) : ?>
				<div class="sol-card" id="<?php echo esc_attr( $slug ); ?>">
					<div class="sol-icon" aria-hidden="true">
						<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?php echo $s['icon']; ?></svg>
					</div>
					<h3><?php echo esc_html( $s['title'] ); ?></h3>
					<p><?php echo esc_html( $s['desc'] ); ?></p>
					<ul class="sol-caps">
						<?php foreach ( $s['caps'] as $cap ) : ?>
							<li><?php echo esc_html( $cap ); ?></li>
						<?php endforeach; ?>
					</ul>
					<?php if ( ! empty( $s['payments'] ) ) : ?>
						<p class="sol-payments"><?php echo esc_html( $s['payments'] ); ?></p>
					<?php endif; ?>
					<a class="sol-card-link" href="<?php echo esc_url( home_url( '/pricing/' ) ); ?>"><?php esc_html_e( 'See pricing →', 'civicflow' ); ?></a>
				</div>
			<?php endforeach; ?>
		</div>

		<div class="sol-cta">
			<h2><?php esc_html_e( "Don't see your organization type?", 'civicflow' ); ?></h2>
			<p><?php esc_html_e( 'Unestra is flexible enough for most membership-based organizations. Tell us about yours.', 'civicflow' ); ?></p>
			<a class="btn btn-primary" href="<?php echo esc_url( home_url( '/support/#contact' ) ); ?>"><?php esc_html_e( 'Get in touch', 'civicflow' ); ?></a>
		</div>
	</div>
</div>

<style>
.sol-page { padding: 4.5rem 0 5rem; }
.sol-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 4rem; }
.sol-card { background: #fff; border: 1px solid var(--cf-border); border-radius: var(--cf-radius-lg); padding: 1.9rem; box-shadow: var(--cf-shadow); display: flex; flex-direction: column; }
.sol-icon { width: 48px; height: 48px; border-radius: 12px; background: var(--cf-green-light); color: var(--cf-green-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 1.1rem; }
.sol-card h3 { font-size: 1.08rem; font-weight: 650; margin-bottom: 0.5rem; }
.sol-card > p { font-size: 0.92rem; color: var(--cf-text-muted); line-height: 1.65; margin-bottom: 1.1rem; }
.sol-caps { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.25rem; flex: 1; }
.sol-caps li { font-size: 0.85rem; color: var(--cf-text-muted); padding-left: 1.1rem; position: relative; line-height: 1.5; }
.sol-caps li::before { content: ""; position: absolute; left: 0; top: 0.5em; width: 5px; height: 5px; border-radius: 50%; background: var(--cf-green); }
.sol-payments { font-size: 0.82rem; color: var(--cf-text-muted); line-height: 1.55; padding-top: 0.9rem; margin-bottom: 1rem; border-top: 1px solid var(--cf-border); }
.sol-card-link { font-size: 0.88rem; font-weight: 600; color: var(--cf-green-dark); text-decoration: none; }
.sol-card-link:hover { text-decoration: underline; }
.sol-cta { text-align: center; background: var(--cf-bg-alt); border-radius: var(--cf-radius-lg); padding: 3rem 2rem; }
.sol-cta h2 { font-size: 1.4rem; margin-bottom: 0.6rem; }
.sol-cta p { color: var(--cf-text-muted); margin-bottom: 1.5rem; }
</style>

<?php get_footer(); ?>
