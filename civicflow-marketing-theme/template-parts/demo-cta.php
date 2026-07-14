<?php
/**
 * Template Part: Demo CTA Banner
 *
 * @package Unestra
 */
?>
<section id="demo-cta" aria-labelledby="demo-heading">
	<div class="container">
		<h2 id="demo-heading"><?php echo esc_html( cf_mod( 'cta_heading', 'See Unestra in action' ) ); ?></h2>
		<p><?php echo esc_html( cf_mod( 'cta_subtext', 'Book a free 30-minute demo and we\'ll walk you through how Unestra can work for your specific organization type and size.' ) ); ?></p>
		<div class="demo-btns">
			<a href="<?php echo esc_url( cf_mod( 'cta_btn1_url', '#contact' ) ); ?>" class="btn btn-white">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
				<?php echo esc_html( cf_mod( 'cta_btn1', 'Book a demo' ) ); ?>
			</a>
			<a href="https://app.getunestra.com/signup" class="btn btn-outline-white" target="_blank" rel="noopener">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
				<?php echo esc_html( cf_mod( 'cta_btn2', 'Start free trial' ) ); ?>
			</a>
		</div>
	</div>
</section>
