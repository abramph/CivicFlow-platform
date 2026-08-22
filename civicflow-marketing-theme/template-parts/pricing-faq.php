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
		'q' => __( 'Is Stripe the only payment method organizations can use?', 'civicflow' ),
		'a' => __( 'No. Stripe provides Unestra\'s integrated online checkout, but organizations can continue accepting approved external methods such as Zelle, Cash App, cash, checks, payroll deductions, or other configured options. External payments occur outside Unestra and may need to be reported, entered, or verified by authorized organization staff.', 'civicflow' ),
	],
	[
		'q' => __( 'Does Unestra connect directly to Zelle or Cash App?', 'civicflow' ),
		'a' => __( 'Not currently. Zelle and Cash App payments are completed outside Unestra. Where enabled, members or staff can document the payment in Unestra so authorized staff can review it and update the appropriate record.', 'civicflow' ),
	],
	[
		'q' => __( 'Are externally reported payments automatically approved?', 'civicflow' ),
		'a' => __( 'No. A reported external payment is not automatically treated as confirmed. The organization\'s authorized staff may need to review the payment details or receipt before updating dues, contribution, or payment records.', 'civicflow' ),
	],
	[
		'q' => __( 'Can organizations decide which payment methods to accept?', 'civicflow' ),
		'a' => __( 'Yes. Each organization determines which external payment methods it accepts and communicates its payment instructions to members. Available Unestra reporting and recording options depend on the organization\'s configuration.', 'civicflow' ),
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
