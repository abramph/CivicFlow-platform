<?php
/**
 * 404 Not Found
 *
 * @package Unestra
 */

get_header();
?>

<div style="padding:6rem 0;text-align:center;background:#f7f9f8;min-height:60vh;display:flex;align-items:center;">
	<div class="container">
		<div style="font-size:6rem;font-weight:700;color:#E1F5EE;line-height:1;margin-bottom:1rem">404</div>
		<h1 style="font-size:2rem;font-weight:600;margin-bottom:1rem"><?php esc_html_e( "This page doesn't exist", 'civicflow' ); ?></h1>
		<p style="font-size:1.05rem;color:#5f5f5f;max-width:420px;margin:0 auto 2.5rem;line-height:1.7">
			<?php esc_html_e( "The page you're looking for may have moved or been removed. Let's get you back on track.", 'civicflow' ); ?>
		</p>
		<div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
			<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="btn btn-primary">
				<?php esc_html_e( 'Back to home', 'civicflow' ); ?>
			</a>
			<a href="<?php echo esc_url( home_url( '/#contact' ) ); ?>" class="btn btn-secondary">
				<?php esc_html_e( 'Contact support', 'civicflow' ); ?>
			</a>
		</div>
	</div>
</div>

<?php get_footer(); ?>
