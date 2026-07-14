<?php
/**
 * Page template — Pricing (dedicated URL; renders the same
 * pricing section shown on the homepage, for a stable
 * linkable /pricing page).
 *
 * @package Unestra
 */

get_header();
?>
<div style="height:2.5rem;"></div>
<?php get_template_part( 'template-parts/pricing' ); ?>
<?php get_template_part( 'template-parts/demo-cta' ); ?>
<?php get_footer(); ?>
