<?php
/**
 * Main Index Template (required fallback)
 * @package CivicFlow
 */
get_header();
?>
<div class="container" style="padding:4rem 1.5rem;min-height:60vh;">
	<?php if ( have_posts() ) : ?>
		<h1 class="section-title"><?php esc_html_e( 'Latest Posts', 'civicflow' ); ?></h1>
		<div style="margin-top:2rem;display:flex;flex-direction:column;gap:2rem;">
			<?php while ( have_posts() ) : the_post(); ?>
				<article id="post-<?php the_ID(); ?>" <?php post_class(); ?>>
					<h2 style="font-size:1.25rem;font-weight:600;margin-bottom:0.5rem;">
						<a href="<?php the_permalink(); ?>"><?php the_title(); ?></a>
					</h2>
					<p style="font-size:13px;color:var(--cf-text-muted);margin-bottom:0.75rem;">
						<?php echo get_the_date(); ?> &middot; <?php the_author(); ?>
					</p>
					<?php the_excerpt(); ?>
					<a href="<?php the_permalink(); ?>" style="color:var(--cf-green);font-size:14px;font-weight:600;">
						<?php esc_html_e( 'Read more &rarr;', 'civicflow' ); ?>
					</a>
				</article>
			<?php endwhile; ?>
		</div>
		<?php the_posts_pagination(); ?>
	<?php else : ?>
		<p><?php esc_html_e( 'No posts found.', 'civicflow' ); ?></p>
	<?php endif; ?>
</div>
<?php get_footer(); ?>
