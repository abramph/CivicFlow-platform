<?php
/**
 * Page template — inner pages (Privacy, Terms, Blog, etc.)
 *
 * @package CivicFlow
 */

get_header();
?>

<div style="padding:4rem 0;background:#f7f9f8;min-height:60vh;">
	<div class="container" style="max-width:780px;">
		<?php while ( have_posts() ) : the_post(); ?>
			<article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
				<h1 style="font-size:clamp(1.8rem,4vw,2.6rem);font-weight:700;margin-bottom:0.5rem;letter-spacing:-0.02em;"><?php the_title(); ?></h1>
				<p style="font-size:13px;color:#5f5f5f;margin-bottom:2.5rem;">
					<?php esc_html_e( 'Last updated:', 'civicflow' ); ?>
					<?php echo esc_html( get_the_modified_date() ); ?>
				</p>
				<div class="page-content" style="color:#3a3a3a;line-height:1.8;font-size:15.5px;">
					<?php the_content(); ?>
				</div>
			</article>
		<?php endwhile; ?>
	</div>
</div>

<style>
.page-content h2{font-size:1.3rem;font-weight:600;margin:2.5rem 0 0.75rem}
.page-content h3{font-size:1.1rem;font-weight:600;margin:2rem 0 0.5rem}
.page-content p{margin-bottom:1.1rem}
.page-content ul,.page-content ol{padding-left:1.5rem;margin-bottom:1.1rem}
.page-content li{margin-bottom:0.4rem}
.page-content a{color:#1D9E75;text-decoration:underline}
.page-content a:hover{color:#0F6E56}
.page-content blockquote{border-left:3px solid #1D9E75;padding:0.75rem 1.25rem;margin:1.5rem 0;background:#E1F5EE;border-radius:0 8px 8px 0;color:#0F6E56}
</style>

<?php get_footer(); ?>
