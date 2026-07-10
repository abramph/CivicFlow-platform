<?php
/**
 * Template Part: Stats Bar
 *
 * @package Unestra
 */

$stats = [
	[ 'num' => 'Windows',    'label' => __( 'Desktop app',     'civicflow' ) ],
	[ 'num' => 'Offline',    'label' => __( 'Capable',         'civicflow' ) ],
	[ 'num' => 'Perpetual',  'label' => __( 'Desktop license', 'civicflow' ) ],
	[ 'num' => 'Your data',  'label' => __( 'Stays with you',  'civicflow' ) ],
];
?>
<div id="stats" aria-label="<?php esc_attr_e( 'Platform highlights', 'civicflow' ); ?>">
	<?php foreach ( $stats as $stat ) : ?>
		<div class="stat-item">
			<span class="stat-num"><?php echo esc_html( $stat['num'] ); ?></span>
			<span class="stat-label"><?php echo esc_html( $stat['label'] ); ?></span>
		</div>
	<?php endforeach; ?>
</div>
