<?php
/**
 * Template Part: Pricing FAQ
 *
 * @package Unestra
 */

$pricing_faqs = [
	[
		'q' => __( 'Are members limited?', 'civicflow' ),
		'a' => __( 'No. Every current Unestra plan supports unlimited members.', 'civicflow' ),
	],
	[
		'q' => __( 'What is an administrative seat?', 'civicflow' ),
		'a' => __( 'An administrative seat is used by an officer, staff member, leader, or other person who manages the organization. Ordinary member access does not consume an administrative seat.', 'civicflow' ),
	],
	[
		'q' => __( 'Is there a free trial?', 'civicflow' ),
		'a' => __( 'Yes. New organizations receive a 30-day Unestra trial. Billing begins only after the organization selects a plan and completes checkout.', 'civicflow' ),
	],
	[
		'q' => __( 'Does Unestra receive our dues and donations?', 'civicflow' ),
		'a' => __( 'Each organization connects its own Stripe account. Eligible collections are processed through Stripe and routed to the connected organization.', 'civicflow' ),
	],
	[
		'q' => __( 'Does Unestra store card numbers?', 'civicflow' ),
		'a' => __( 'No. Checkout is hosted by Stripe, and Unestra does not collect or store complete card numbers in the application.', 'civicflow' ),
	],
	[
		'q' => __( 'Is Unestra a public social network?', 'civicflow' ),
		'a' => __( 'No. Communication is organization-scoped and designed for private interaction between members and authorized organization staff.', 'civicflow' ),
	],
	[
		'q' => __( 'Does Unestra host video meetings?', 'civicflow' ),
		'a' => __( 'No. Unestra can organize meeting information and provide links to services such as Zoom or Microsoft Teams, but it does not host the video meeting itself.', 'civicflow' ),
	],
	[
		'q' => __( 'What happens when the trial ends?', 'civicflow' ),
		'a' => __( 'Protected organization access pauses until a current subscription is activated. Organization owners retain access to billing recovery, support, security, and required account functions.', 'civicflow' ),
	],
];
?>
<div class="pricing-faq" aria-labelledby="pricing-faq-heading">
	<h3 id="pricing-faq-heading" class="pricing-faq-heading"><?php esc_html_e( 'Frequently asked questions', 'civicflow' ); ?></h3>
	<dl class="pricing-faq-list">
		<?php foreach ( $pricing_faqs as $faq ) : ?>
			<div class="pricing-faq-item">
				<dt><?php echo esc_html( $faq['q'] ); ?></dt>
				<dd><?php echo esc_html( $faq['a'] ); ?></dd>
			</div>
		<?php endforeach; ?>
	</dl>
</div>
