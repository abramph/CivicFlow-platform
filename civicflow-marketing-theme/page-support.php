<?php
/**
 * Page template — Support
 *
 * @package Unestra
 */

get_header();

$faqs = [
	[
		'q' => 'How do I sign in to Unestra?',
		'a' => 'Go to <a href="https://app.getunestra.com/login">app.getunestra.com/login</a> and sign in with the email and password your organization administrator set up for you.',
	],
	[
		'q' => 'I forgot my password. How do I reset it?',
		'a' => 'On the sign-in page, select "Forgot password?" and enter your email address. You\'ll receive a password reset link by email.',
	],
	[
		'q' => 'How do I install the desktop application?',
		'a' => 'Visit the <a href="' . home_url( '/downloads' ) . '">Downloads page</a>, choose Windows or macOS, and run the installer. See that page for step-by-step installation instructions for each platform.',
	],
	[
		'q' => 'I\'m an organization administrator — how do I invite members?',
		'a' => 'From your organization dashboard, go to Members and use the invite option to send a member their own login. Members can also be invited to the mobile app separately.',
	],
	[
		'q' => 'How do I use the member mobile app?',
		'a' => 'Members receive an email invitation with a link to set up mobile access. Once set up, members can check dues status, report payments, view announcements, and check in to events by QR code.',
	],
	[
		'q' => 'Can I switch between multiple organizations?',
		'a' => 'If you belong to more than one organization on Unestra, you can switch between them from the organization selector after signing in.',
	],
	[
		'q' => 'How do I contact support?',
		'a' => 'Email <a href="mailto:support@getunestra.com">support@getunestra.com</a> and we\'ll get back to you. You can also use the contact form below.',
	],
	[
		'q' => 'Where do I report a security concern?',
		'a' => 'Please email <a href="mailto:security@getunestra.com">security@getunestra.com</a> directly rather than filing a public report. See our <a href="' . home_url( '/security' ) . '">Security page</a> for details.',
	],
];
?>

<div class="sup-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3rem;max-width:640px;">
			<p class="section-label"><?php esc_html_e( 'Support', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'How can we help?', 'civicflow' ); ?></h1>
			<p class="section-sub" style="margin:0 auto;"><?php esc_html_e( 'Answers to common questions, or reach our team directly.', 'civicflow' ); ?></p>
		</div>

		<div class="sup-quick-links">
			<a href="https://app.getunestra.com/login" class="sup-quick-link">
				<strong><?php esc_html_e( 'Sign in', 'civicflow' ); ?></strong>
				<span><?php esc_html_e( 'app.getunestra.com', 'civicflow' ); ?></span>
			</a>
			<a href="<?php echo esc_url( home_url( '/downloads' ) ); ?>" class="sup-quick-link">
				<strong><?php esc_html_e( 'Desktop download', 'civicflow' ); ?></strong>
				<span><?php esc_html_e( 'Windows &amp; macOS', 'civicflow' ); ?></span>
			</a>
			<a href="mailto:support@getunestra.com" class="sup-quick-link">
				<strong><?php esc_html_e( 'Email support', 'civicflow' ); ?></strong>
				<span>support@getunestra.com</span>
			</a>
		</div>

		<div class="sup-faq">
			<h2><?php esc_html_e( 'Frequently asked questions', 'civicflow' ); ?></h2>
			<?php foreach ( $faqs as $i => $faq ) : ?>
				<details class="sup-faq-item"<?php echo 0 === $i ? ' open' : ''; ?>>
					<summary><?php echo esc_html( $faq['q'] ); ?></summary>
					<p><?php echo wp_kses( $faq['a'], [ 'a' => [ 'href' => [] ] ] ); ?></p>
				</details>
			<?php endforeach; ?>
		</div>

		<?php get_template_part( 'template-parts/contact' ); ?>
	</div>
</div>

<style>
.sup-page { padding: 4.5rem 0 2rem; }
.sup-quick-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 3.5rem; }
.sup-quick-link { display: flex; flex-direction: column; gap: 0.3rem; background: var(--cf-green-light); border-radius: var(--cf-radius-lg); padding: 1.5rem; transition: transform 0.15s ease; }
.sup-quick-link:hover { transform: translateY(-2px); }
.sup-quick-link strong { color: var(--cf-green-dark); font-size: 1.02rem; }
.sup-quick-link span { color: var(--cf-text-muted); font-size: 0.88rem; }
.sup-faq { max-width: 760px; margin: 0 auto 4rem; }
.sup-faq h2 { font-size: 1.4rem; margin-bottom: 1.5rem; text-align: center; }
.sup-faq-item { border-bottom: 1px solid var(--cf-border); padding: 1.1rem 0; }
.sup-faq-item summary { cursor: pointer; font-weight: 600; font-size: 1rem; list-style: none; display: flex; justify-content: space-between; align-items: center; }
.sup-faq-item summary::-webkit-details-marker { display: none; }
.sup-faq-item summary::after { content: "+"; font-size: 1.3rem; color: var(--cf-green); font-weight: 400; margin-left: 1rem; }
.sup-faq-item[open] summary::after { content: "\2212"; }
.sup-faq-item p { margin-top: 0.75rem; color: var(--cf-text-muted); font-size: 0.95rem; line-height: 1.7; }
.sup-faq-item p a { color: var(--cf-green); text-decoration: underline; }
</style>

<?php get_footer(); ?>
