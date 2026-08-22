<?php
/**
 * Front Page Template
 *
 * WordPress uses this when Settings → Reading is set to a static front page.
 *
 * @package Unestra
 */

get_header();

get_template_part( 'template-parts/hero' );
get_template_part( 'template-parts/verticals' );
get_template_part( 'template-parts/stats' );
get_template_part( 'template-parts/features' );
get_template_part( 'template-parts/platform' );
get_template_part( 'template-parts/pricing' );
get_template_part( 'template-parts/about' );
get_template_part( 'template-parts/demo-cta' );
get_template_part( 'template-parts/contact' );

get_footer();
