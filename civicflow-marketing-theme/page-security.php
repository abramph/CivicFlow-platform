<?php
/**
 * Page template — Security
 *
 * @package Unestra
 */

get_header();

$practices = [
	[ 'title' => 'Encrypted connections', 'desc' => 'All traffic to Unestra Cloud and the member portal is encrypted in transit over HTTPS/TLS.' ],
	[ 'title' => 'Secure authentication', 'desc' => 'Passwords are hashed, never stored in plain text. Sessions use secure, host-only cookies.' ],
	[ 'title' => 'Multi-factor authentication', 'desc' => 'Administrators can enable MFA on their accounts for an additional layer of login protection.' ],
	[ 'title' => 'Role-based access control', 'desc' => 'Every user is assigned a role that defines exactly what they can see and do — least-privilege by default.' ],
	[ 'title' => 'Tenant separation', 'desc' => 'Every organization\'s data is logically isolated from every other organization on the platform.' ],
	[ 'title' => 'Audit logging', 'desc' => 'Sensitive actions are recorded with a timestamp and actor, so administrators can review who did what.' ],
	[ 'title' => 'Secure payment processing', 'desc' => 'Payments are processed through Stripe. Unestra never stores full card numbers on its own servers.' ],
	[ 'title' => 'Authenticated email delivery', 'desc' => 'Transactional email is sent through domain-authenticated infrastructure (SPF, DKIM, and DMARC).' ],
	[ 'title' => 'Backups', 'desc' => 'Production data is backed up regularly by our managed database provider.' ],
	[ 'title' => 'Access controls', 'desc' => 'Production infrastructure access is limited to the individuals who need it to operate the platform.' ],
];
?>

<div class="sec-page">
	<div class="sec-hero">
		<div class="container">
			<p class="section-label" style="color:#fff;"><?php esc_html_e( 'Security', 'civicflow' ); ?></p>
			<h1 class="sec-hero-title"><?php esc_html_e( 'Security is built into Unestra, not bolted on', 'civicflow' ); ?></h1>
			<p class="sec-hero-sub"><?php esc_html_e( 'How we protect your organization\'s data, members, and payments.', 'civicflow' ); ?></p>
		</div>
	</div>

	<div class="container">
		<div class="sec-grid">
			<?php foreach ( $practices as $p ) : ?>
				<div class="sec-card">
					<div class="sec-check" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
					</div>
					<h3><?php echo esc_html( $p['title'] ); ?></h3>
					<p><?php echo esc_html( $p['desc'] ); ?></p>
				</div>
			<?php endforeach; ?>
		</div>

		<div class="sec-notice">
			<h2><?php esc_html_e( 'What we don\'t claim', 'civicflow' ); ?></h2>
			<p><?php esc_html_e( 'We believe in being precise about our security posture. Unestra does not currently hold SOC 2, HIPAA, PCI, or ISO certifications, and we do not claim end-to-end encryption. If your organization requires a specific compliance certification, please contact us to discuss your requirements before subscribing.', 'civicflow' ); ?></p>
		</div>

		<div class="sec-disclosure">
			<h2><?php esc_html_e( 'Responsible disclosure', 'civicflow' ); ?></h2>
			<p><?php esc_html_e( 'If you believe you\'ve found a security vulnerability in Unestra, please report it to us directly rather than disclosing it publicly. We\'ll investigate every report.', 'civicflow' ); ?></p>
			<a class="btn btn-primary" href="mailto:security@getunestra.com">security@getunestra.com</a>
		</div>
	</div>
</div>

<style>
.sec-hero { background: linear-gradient(135deg, var(--cf-green-deep), var(--cf-green-dark)); padding: 4.5rem 0 3.5rem; color: #fff; text-align: center; }
.sec-hero-title { font-size: clamp(1.8rem, 4vw, 2.6rem); font-weight: 700; margin: 0.5rem 0 1rem; max-width: 720px; margin-left: auto; margin-right: auto; letter-spacing: -0.02em; }
.sec-hero-sub { font-size: 1.1rem; opacity: 0.92; max-width: 560px; margin: 0 auto; }
.sec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin: 3.5rem 0; }
.sec-card { background: #fff; border: 1px solid var(--cf-border); border-radius: var(--cf-radius-lg); padding: 1.75rem; box-shadow: var(--cf-shadow); }
.sec-check { width: 34px; height: 34px; border-radius: 8px; background: var(--cf-green-light); color: var(--cf-green-dark); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; }
.sec-card h3 { font-size: 1.02rem; font-weight: 650; margin-bottom: 0.4rem; }
.sec-card p { font-size: 0.9rem; color: var(--cf-text-muted); }
.sec-notice { background: var(--cf-bg-alt); border-radius: var(--cf-radius-lg); padding: 2rem; margin-bottom: 2.5rem; }
.sec-notice h2 { font-size: 1.15rem; margin-bottom: 0.75rem; }
.sec-notice p { color: var(--cf-text-muted); font-size: 0.95rem; }
.sec-disclosure { text-align: center; padding: 2.5rem 0 4rem; }
.sec-disclosure h2 { font-size: 1.3rem; margin-bottom: 0.75rem; }
.sec-disclosure p { color: var(--cf-text-muted); max-width: 520px; margin: 0 auto 1.5rem; }
</style>

<?php get_footer(); ?>
