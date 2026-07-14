<?php
/**
 * Page template — About Unestra
 *
 * @package Unestra
 */

get_header();
?>

<div class="ab-page">
	<div class="container">
		<div class="section-header" style="text-align:center;margin:0 auto 3rem;max-width:680px;">
			<p class="section-label"><?php esc_html_e( 'About', 'civicflow' ); ?></p>
			<h1 class="section-title"><?php esc_html_e( 'About Unestra', 'civicflow' ); ?></h1>
		</div>

		<div class="ab-intro">
			<p><?php esc_html_e( 'Unestra is a membership and organizational management platform built for nonprofits, civic associations, unions, churches, community groups, and other membership-based organizations. It brings member records, dues and payments, events and attendance, communications, and reporting into one connected system — available as a cloud portal, a member mobile app, and a desktop application.', 'civicflow' ); ?></p>
			<p><?php esc_html_e( 'The problem Unestra solves is a familiar one for anyone who has run an organization\'s administration by hand: member information scattered across spreadsheets, dues tracked separately from payments, event sign-ups managed in yet another tool, and no single place to see the whole picture. Unestra puts all of it in one system, so organization leaders and staff can spend less time on administrative overhead and more time on the work that matters to their members.', 'civicflow' ); ?></p>
		</div>

		<div class="ab-aph">
			<h2><?php esc_html_e( 'A product of APH Technologies LLC', 'civicflow' ); ?></h2>
			<p><?php esc_html_e( 'Unestra is developed and operated by APH Technologies LLC.', 'civicflow' ); ?></p>
			<a class="btn btn-secondary" href="https://aphtechgroup.com" target="_blank" rel="noopener">
				<?php esc_html_e( 'Visit APH Technologies', 'civicflow' ); ?> &rarr;
			</a>
		</div>
	</div>
</div>

<?php get_template_part( 'template-parts/about' ); ?>

<div class="container ab-cta-wrap">
	<div class="ab-cta">
		<h2><?php esc_html_e( 'See Unestra for your organization', 'civicflow' ); ?></h2>
		<a class="btn btn-primary" href="<?php echo esc_url( home_url( '/support/#contact' ) ); ?>"><?php esc_html_e( 'Get in touch', 'civicflow' ); ?></a>
		<a class="btn btn-secondary" href="https://app.getunestra.com/login"><?php esc_html_e( 'Sign in', 'civicflow' ); ?></a>
	</div>
</div>

<style>
.ab-page { padding: 4.5rem 0 1rem; }
.ab-intro { max-width: 700px; margin: 0 auto 3.5rem; }
.ab-intro p { color: var(--cf-text-muted); font-size: 1.02rem; line-height: 1.8; margin-bottom: 1.25rem; }
.ab-aph { max-width: 560px; margin: 0 auto 4rem; text-align: center; background: var(--cf-bg-alt); border-radius: var(--cf-radius-lg); padding: 2.25rem; }
.ab-aph h2 { font-size: 1.15rem; margin-bottom: 0.6rem; }
.ab-aph p { color: var(--cf-text-muted); margin-bottom: 1.25rem; }
.ab-cta-wrap { padding: 4rem 0 5rem; }
.ab-cta { text-align: center; }
.ab-cta h2 { font-size: 1.5rem; margin-bottom: 1.5rem; }
.ab-cta .btn { margin: 0 0.4rem; }
</style>

<?php get_footer(); ?>
