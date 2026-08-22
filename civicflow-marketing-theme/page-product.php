<?php
/**
 * Page template — Product overview
 *
 * @package Unestra
 */

get_header();

$modules = [
	[ 'title' => 'Membership management', 'desc' => 'Complete member records, custom fields, enrollment status, and relationship history.' ],
	[ 'title' => 'Multi-organization membership', 'desc' => 'Members and staff can belong to more than one organization and switch between them.' ],
	[ 'title' => 'Role-based access control', 'desc' => 'Define roles and permissions across your organization, enforced at every level.' ],
	[ 'title' => 'Member portal & mobile app', 'desc' => 'A dedicated member-facing web portal and mobile app for dues, payments, and announcements.' ],
	[ 'title' => 'Payments & dues', 'desc' => 'Collect dues and contributions, reconcile payments, and track balances. Use integrated Stripe checkout, or continue accepting external methods like Zelle, Cash App, cash, and check with organization review.' ],
	[ 'title' => 'Announcements', 'desc' => 'Send organization-wide announcements to members by email, SMS, or push notification.' ],
	[ 'title' => 'Events & meetings', 'desc' => 'Plan events and meetings, send invites, and track RSVPs and attendance.' ],
	[ 'title' => 'QR meeting attendance', 'desc' => 'Members check in to meetings by scanning a QR code — attendance is recorded automatically.' ],
	[ 'title' => 'Inbox & messaging', 'desc' => 'Two-way messaging between staff and members, in one shared inbox.' ],
	[ 'title' => 'Email, SMS & push notifications', 'desc' => 'Reach members on the channel they actually use, with opt-in/opt-out managed per member.' ],
	[ 'title' => 'Reporting & exports', 'desc' => 'On-demand reports on membership, finances, attendance, and campaigns — exportable to Excel or PDF.' ],
	[ 'title' => 'Audit trails', 'desc' => 'Sensitive actions are logged with a timestamp and actor for accountability.' ],
	[ 'title' => 'Document management', 'desc' => 'Store bylaws, minutes, policies, and member documents securely with access controls.' ],
	[ 'title' => 'Campaigns', 'desc' => 'Coordinate campaigns, track participation, and measure engagement across initiatives.' ],
	[ 'title' => 'Desktop application', 'desc' => 'A full offline-capable desktop app for Windows and macOS, with local data storage.' ],
	[ 'title' => 'Cloud portal', 'desc' => 'A fully hosted, always-up-to-date web application accessible from any browser.' ],
];
?>

<div class="prod-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3.5rem;max-width:680px;">
			<p class="section-label"><?php esc_html_e( 'Product', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'One platform, everything your organization needs', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Unestra brings membership, payments, events, communications, and reporting together — available on the cloud, desktop, and mobile.', 'civicflow' ); ?></p>
		</div>

		<div class="prod-grid">
			<?php foreach ( $modules as $m ) : ?>
				<div class="prod-item">
					<h3><?php echo esc_html( $m['title'] ); ?></h3>
					<p><?php echo esc_html( $m['desc'] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>
	</div>
</div>

<?php get_template_part( 'template-parts/platform' ); ?>

<div class="container prod-cta-wrap">
	<div class="prod-cta">
		<a class="btn btn-primary" href="https://app.getunestra.com/signup"><?php esc_html_e( 'Get started', 'civicflow' ); ?></a>
		<a class="btn btn-secondary" href="<?php echo esc_url( home_url( '/pricing' ) ); ?>"><?php esc_html_e( 'See pricing', 'civicflow' ); ?></a>
	</div>
</div>

<style>
.prod-page { padding: 4.5rem 0 4rem; }
.prod-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.75rem 2rem; }
.prod-item { border-left: 3px solid var(--cf-green); padding-left: 1.1rem; }
.prod-item h3 { font-size: 1rem; font-weight: 650; margin-bottom: 0.35rem; }
.prod-item p { font-size: 0.9rem; color: var(--cf-text-muted); line-height: 1.6; }
.prod-cta-wrap { padding: 3.5rem 0 5rem; text-align: center; }
.prod-cta .btn { margin: 0 0.4rem; }
</style>

<?php get_footer(); ?>
