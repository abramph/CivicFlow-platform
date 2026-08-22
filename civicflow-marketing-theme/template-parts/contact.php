<?php
/**
 * Template Part: Contact Section
 *
 * @package Unestra
 */

$contact_items = [
	[
		'label' => __( 'Email us', 'civicflow' ),
		'value' => cf_mod( 'contact_email', 'support@getunestra.com' ),
		'icon'  => '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
	],
	[
		'label' => __( 'Support hours', 'civicflow' ),
		'value' => cf_mod( 'contact_hours', 'Mon–Fri, 9am–6pm ET' ),
		'icon'  => '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
	],
	[
		'label' => __( 'We serve', 'civicflow' ),
		'value' => __( 'PTA/PTO · Churches · Unions · Community Organizations', 'civicflow' ),
		'icon'  => '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
	],
];
?>
<section id="contact" aria-labelledby="contact-heading">
	<div class="container">
		<div class="section-header">
			<p class="section-label"><?php esc_html_e( 'Contact', 'civicflow' ); ?></p>
			<h2 class="section-title" id="contact-heading"><?php esc_html_e( 'Let\'s talk about your organization', 'civicflow' ); ?></h2>
			<p class="section-sub"><?php esc_html_e( 'Whether you\'re ready to get started or just exploring, we\'d love to hear from you.', 'civicflow' ); ?></p>
		</div>

		<div class="contact-grid">

			<!-- Contact info -->
			<div class="contact-info">
				<?php foreach ( $contact_items as $item ) : ?>
					<div class="contact-info-item">
						<div class="contact-info-icon" aria-hidden="true">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<?php echo $item['icon']; ?>
							</svg>
						</div>
						<div>
							<strong><?php echo esc_html( $item['label'] ); ?></strong>
							<span><?php echo esc_html( $item['value'] ); ?></span>
						</div>
					</div>
				<?php endforeach; ?>
			</div>

			<!-- Contact form -->
			<div>
				<form class="cf-form" id="civicflow-contact-form" novalidate aria-label="<?php esc_attr_e( 'Contact form', 'civicflow' ); ?>">
					<?php wp_nonce_field( 'civicflow_contact', 'cf_nonce' ); ?>

					<div class="form-row">
						<div class="field">
							<label for="cf-name"><?php esc_html_e( 'Your name', 'civicflow' ); ?> <span aria-hidden="true">*</span></label>
							<input type="text" id="cf-name" name="cf_name" placeholder="<?php esc_attr_e( 'Jane Smith', 'civicflow' ); ?>" required autocomplete="name">
						</div>
						<div class="field">
							<label for="cf-email"><?php esc_html_e( 'Email address', 'civicflow' ); ?> <span aria-hidden="true">*</span></label>
							<input type="email" id="cf-email" name="cf_email" placeholder="<?php esc_attr_e( 'jane@myorg.org', 'civicflow' ); ?>" required autocomplete="email">
						</div>
					</div>

					<div class="field">
						<label for="cf-org"><?php esc_html_e( 'Organization name', 'civicflow' ); ?></label>
						<input type="text" id="cf-org" name="cf_org" placeholder="<?php esc_attr_e( 'My Community Organization', 'civicflow' ); ?>" autocomplete="organization">
					</div>

					<div class="form-row">
						<div class="field">
							<label for="cf-type"><?php esc_html_e( 'Organization type', 'civicflow' ); ?></label>
							<select id="cf-type" name="cf_type">
								<option value=""><?php esc_html_e( 'Select type…', 'civicflow' ); ?></option>
								<option value="pta"><?php esc_html_e( 'PTA / PTO', 'civicflow' ); ?></option>
								<option value="church"><?php esc_html_e( 'Church', 'civicflow' ); ?></option>
								<option value="union"><?php esc_html_e( 'Union', 'civicflow' ); ?></option>
								<option value="community"><?php esc_html_e( 'Community Organization', 'civicflow' ); ?></option>
								<option value="other"><?php esc_html_e( 'Other membership organization', 'civicflow' ); ?></option>
							</select>
						</div>
						<div class="field">
							<label for="cf-interest"><?php esc_html_e( 'I\'m interested in…', 'civicflow' ); ?></label>
							<select id="cf-interest" name="cf_interest">
								<option value=""><?php esc_html_e( 'Select…', 'civicflow' ); ?></option>
								<option value="demo"><?php esc_html_e( 'Scheduling a demo', 'civicflow' ); ?></option>
								<option value="trial"><?php esc_html_e( 'Starting a free trial', 'civicflow' ); ?></option>
								<option value="pricing"><?php esc_html_e( 'Pricing information', 'civicflow' ); ?></option>
								<option value="desktop"><?php esc_html_e( 'The desktop version', 'civicflow' ); ?></option>
								<option value="general"><?php esc_html_e( 'General question', 'civicflow' ); ?></option>
							</select>
						</div>
					</div>

					<div class="field">
						<label for="cf-message"><?php esc_html_e( 'Message (optional)', 'civicflow' ); ?></label>
						<textarea id="cf-message" name="cf_message" placeholder="<?php esc_attr_e( 'Tell us about your organization or what you\'re looking for…', 'civicflow' ); ?>"></textarea>
					</div>

					<div class="field" id="cf-error" style="display:none;">
						<p style="color:#A32D2D; font-size:14px;" role="alert"></p>
					</div>

					<button type="submit" class="cf-submit">
						<?php esc_html_e( 'Send message', 'civicflow' ); ?>
					</button>

					<div class="form-success" id="cf-success" role="status" aria-live="polite">
						<?php esc_html_e( '✓ Thank you! We\'ll be in touch soon.', 'civicflow' ); ?>
					</div>
				</form>
			</div>

		</div>
	</div>
</section>
