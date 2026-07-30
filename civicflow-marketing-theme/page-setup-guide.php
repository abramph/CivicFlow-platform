<?php
/**
 * Template Name: Setup Guide
 * Template Post Type: page
 *
 * @package Unestra
 */

get_header();
?>

<div class="sg-wrap">

	<!-- ── Page hero ── -->
	<div class="sg-hero">
		<div class="container">
			<p class="sg-eyebrow">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
				Getting started
			</p>
			<h1>Unestra Setup Guide</h1>
			<p class="sg-hero-sub">Everything you need to get your organization up and running — whether you choose cloud or desktop.</p>

			<!-- Tab switcher -->
			<div class="sg-tabs" role="tablist" aria-label="Platform setup guides">
				<button class="sg-tab active" role="tab" aria-selected="true"  aria-controls="tab-cloud"   id="btn-cloud"   data-tab="cloud">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
					Cloud version
				</button>
				<button class="sg-tab" role="tab" aria-selected="false" aria-controls="tab-desktop" id="btn-desktop" data-tab="desktop">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
					Desktop version
				</button>
			</div>
		</div>
	</div><!-- .sg-hero -->

	<div class="container">

		<!-- ══════════════════════════════════════
		     CLOUD TAB
		══════════════════════════════════════ -->
		<div id="tab-cloud" class="sg-panel active" role="tabpanel" aria-labelledby="btn-cloud">

			<div class="sg-intro-row">
				<div class="sg-intro-text">
					<h2>Cloud version — quick start</h2>
					<p>The cloud version runs entirely in your browser. There's nothing to install. You'll be fully operational within minutes of signing up.</p>
				</div>
				<div class="sg-req-box">
					<p class="sg-req-title">Requirements</p>
					<ul>
						<li>Any modern browser (Chrome, Safari, Firefox, Edge)</li>
						<li>Internet connection</li>
						<li>Email address for each user</li>
					</ul>
				</div>
			</div>

			<!-- Steps -->
			<ol class="sg-steps">

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">1</div>
					<div class="sg-step-body">
						<h3>Create your account</h3>
						<p>Go to the Unestra portal and sign up with your email address. You'll be the organization owner/admin.</p>
						<a href="https://app.getunestra.com/signup" class="sg-btn sg-btn-primary" target="_blank" rel="noopener">
							<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
							Sign up free
						</a>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">2</div>
					<div class="sg-step-body">
						<h3>Confirm your email</h3>
						<p>Check your inbox for a confirmation email from Unestra. Click the link to verify your address and activate your account. If you don't see it within a minute, check your spam folder.</p>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">3</div>
					<div class="sg-step-body">
						<h3>Set up your organization</h3>
						<p>After logging in, you'll walk through a short setup wizard. You'll enter:</p>
						<ul class="sg-list">
							<li>Organization name and type (nonprofit, civic, church, association, etc.)</li>
							<li>Primary contact information</li>
							<li>Fiscal year start month</li>
							<li>Default dues cycle (monthly, quarterly, annually)</li>
						</ul>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">4</div>
					<div class="sg-step-body">
						<h3>Choose your plan</h3>
						<p>Select the plan that fits your organization. You can upgrade at any time.</p>
						<div class="sg-plan-compare">
							<div class="sg-plan-card">
								<p class="sg-plan-name">Essential</p>
								<p class="sg-plan-price">$49<span>/mo</span></p>
								<ul>
									<li>Up to 5 seats</li>
									<li>Member management & dues</li>
									<li>Events & campaigns</li>
									<li>Financial tracking</li>
									<li>Core reports</li>
								</ul>
							</div>
							<div class="sg-plan-card sg-plan-popular">
								<p class="sg-plan-badge">Most popular</p>
								<p class="sg-plan-name">Elite</p>
								<p class="sg-plan-price">$99<span>/mo</span></p>
								<ul>
									<li>Everything in Essential</li>
									<li>Advanced analytics</li>
									<li>Communications module</li>
									<li>Grant tracking</li>
									<li>Priority support</li>
									<li>Additional seats at $5/mo each</li>
								</ul>
							</div>
						</div>
						<p class="sg-note">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
							Save up to 10% with an annual plan. Pricing shown monthly.
						</p>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">5</div>
					<div class="sg-step-body">
						<h3>Invite your team</h3>
						<p>Go to <strong>Settings → Team Members</strong> and invite co-administrators, staff, or board members by email. Each invited user gets their own login — no shared passwords.</p>
						<div class="sg-callout sg-callout-info">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
							<span>Role options: <strong>Admin</strong> (full access), <strong>Staff</strong> (manage members & events), <strong>Viewer</strong> (read-only reports).</span>
						</div>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">6</div>
					<div class="sg-step-body">
						<h3>Import your existing members</h3>
						<p>Navigate to <strong>Members → Import</strong>. Download the CSV template, fill in your existing member data, and upload. Unestra maps common column names automatically.</p>
						<p>Supported import columns: First name, Last name, Email, Phone, Address, Join date, Membership type, Dues amount, Notes.</p>
					</div>
				</li>

				<li class="sg-step">
					<div class="sg-step-num" aria-hidden="true">7</div>
					<div class="sg-step-body">
						<h3>You're ready</h3>
						<p>Explore your dashboard. A few things to do first:</p>
						<ul class="sg-checklist">
							<li><span class="sg-check" aria-hidden="true">✓</span> Add or import members</li>
							<li><span class="sg-check" aria-hidden="true">✓</span> Set up your first dues cycle</li>
							<li><span class="sg-check" aria-hidden="true">✓</span> Create an upcoming event</li>
							<li><span class="sg-check" aria-hidden="true">✓</span> Run a membership report</li>
							<li><span class="sg-check" aria-hidden="true">✓</span> Connect your bank account for financial tracking</li>
						</ul>
					</div>
				</li>

			</ol><!-- .sg-steps -->

		</div><!-- #tab-cloud -->


		<!-- ══════════════════════════════════════
		     DESKTOP TAB
		══════════════════════════════════════ -->
		<div id="tab-desktop" class="sg-panel" role="tabpanel" aria-labelledby="btn-desktop" hidden>

			<div class="sg-intro-row">
				<div class="sg-intro-text">
					<h2>Desktop version — installation guide</h2>
					<p>The desktop version installs directly on your computer and runs on your local network. It works fully offline. No internet connection is required after activation.</p>
				</div>
				<div class="sg-req-box">
					<p class="sg-req-title">System requirements</p>
					<ul>
						<li><strong>Windows:</strong> Windows 10 or later (64-bit)</li>
						<li><strong>macOS:</strong> macOS 12 Monterey or later, Apple Silicon (M1/M2/M3)</li>
						<li>4 GB RAM minimum, 8 GB recommended</li>
						<li>500 MB free disk space</li>
						<li>Internet required only for initial license activation</li>
					</ul>
				</div>
			</div>

			<!-- Platform sub-tabs -->
			<div class="sg-os-tabs" role="tablist" aria-label="Operating system">
				<button class="sg-os-tab active" role="tab" aria-selected="true" aria-controls="os-windows" id="btn-win" data-os="windows">
					<svg width="15" height="15" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true"><path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.851" transform="scale(33.9)"/></svg>
					Windows
				</button>
				<button class="sg-os-tab" role="tab" aria-selected="false" aria-controls="os-mac" id="btn-mac" data-os="mac">
					<svg width="15" height="15" viewBox="0 0 814 1000" fill="currentColor" aria-hidden="true"><path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46 790.4 0 663.9 0 541.2c0-207.8 127.5-317.8 254.2-317.8 68.2 0 124.6 44.8 167.8 44.8 40.9 0 107.2-47.8 183.8-47.8zm-82.5-208.5C727.7 90.2 744 53.1 744 21.9c0-17.5-1.3-35.6-3.9-50.8C686.5 3.3 626.5 29.4 593.4 66.7c-26.9 31.4-52.5 82.5-52.5 133.6 0 19.5 3.2 39 4.5 45.4 3.2.6 8.4 1.3 13.6 1.3 49.9 0 113.4-25.4 143.6-73.9z"/></svg>
					macOS
				</button>
			</div>

			<!-- Windows -->
			<div id="os-windows" class="sg-os-panel active">
				<ol class="sg-steps">

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">1</div>
						<div class="sg-step-body">
							<h3>Download the installer</h3>
							<p>Download the Windows installer (.exe). The file is approximately 130 MB.</p>
							<a href="<?php echo esc_url( home_url( '/download/windows' ) ); ?>" class="sg-btn sg-btn-primary">
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
								Download for Windows
							</a>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">2</div>
						<div class="sg-step-body">
							<h3>Run the installer</h3>
							<p>Double-click the downloaded .exe file to launch the installer. If Windows SmartScreen shows a warning, click <strong>More info</strong> then <strong>Run anyway</strong>.</p>
							<p>Follow the installation wizard — choose your install directory, then click <strong>Install</strong>. A desktop shortcut is created automatically.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">3</div>
						<div class="sg-step-body">
							<h3>Purchase a license (if you haven't already)</h3>
							<p>Unestra Desktop requires a license key. Each license includes 5 seats. Additional seats can be purchased separately.</p>
							<div class="sg-dl-row">
								<a href="https://buy.stripe.com/6oUcN61g54W92wL9ik3VC01" class="sg-btn sg-btn-outline" target="_blank" rel="noopener">
									Purchase a license key →
								</a>
							</div>
							<p class="sg-note-sm">Your license key will be emailed to you immediately after purchase.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">4</div>
						<div class="sg-step-body">
							<h3>Activate your license</h3>
							<p>Launch Unestra. On the activation screen:</p>
							<ul class="sg-list">
								<li>Enter your <strong>license key</strong> (format: CF-XXXX-XXXX-XXXX-XXXX)</li>
								<li>Enter the <strong>email address</strong> you used to purchase</li>
								<li>Click <strong>Activate</strong></li>
							</ul>
							<p>The app contacts the Unestra license server to validate your key. An internet connection is required for this step only.</p>
							<div class="sg-callout sg-callout-info">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
								<span>You can also activate and manage licenses at <a href="https://api.civicflowapp.com/admin" target="_blank" rel="noopener">api.civicflowapp.com/admin</a>.</span>
							</div>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">5</div>
						<div class="sg-step-body">
							<h3>Complete the setup wizard</h3>
							<p>After activation, the setup wizard guides you through:</p>
							<ul class="sg-list">
								<li>Organization name and type</li>
								<li>Admin account creation</li>
								<li>Fiscal year and dues settings</li>
								<li>Adding your first members</li>
							</ul>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">6</div>
						<div class="sg-step-body">
							<h3>Invite team members (multi-user setup)</h3>
							<p>Unestra Desktop supports up to 5 users on your local network (more with additional seats). To add another user:</p>
							<ul class="sg-list">
								<li>Go to <strong>Settings → Users</strong></li>
								<li>Click <strong>Add user</strong> and assign a role</li>
								<li>The new user opens Unestra on their computer and points to your server's local IP address</li>
							</ul>
						</div>
					</li>

				</ol>
			</div><!-- #os-windows -->

			<!-- macOS -->
			<div id="os-mac" class="sg-os-panel" hidden>
				<ol class="sg-steps">

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">1</div>
						<div class="sg-step-body">
							<h3>Download the installer</h3>
							<p>Download the macOS disk image (.dmg). The file is approximately 161 MB. This build is optimized for Apple Silicon (M1, M2, M3).</p>
							<a href="<?php echo esc_url( home_url( '/download/macos' ) ); ?>" class="sg-btn sg-btn-primary">
								<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
								Download for macOS (Apple Silicon)
							</a>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">2</div>
						<div class="sg-step-body">
							<h3>Open the DMG</h3>
							<p>Double-click the downloaded .dmg file to mount it. A Finder window will open showing the Unestra app icon.</p>
							<p>Drag the <strong>Unestra</strong> icon into the <strong>Applications</strong> folder shortcut shown in the same window.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">3</div>
						<div class="sg-step-body">
							<h3>First launch</h3>
							<p>Open Unestra from your Applications folder or Launchpad. Unestra for Mac is signed and notarized by APH Technologies, so it launches normally — no Gatekeeper warnings, no extra steps.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">4</div>
						<div class="sg-step-body">
							<h3>Purchase a license (if you haven't already)</h3>
							<p>Unestra Desktop requires a license key. Each license includes 5 seats.</p>
							<a href="https://buy.stripe.com/6oUcN61g54W92wL9ik3VC01" class="sg-btn sg-btn-outline" target="_blank" rel="noopener">
								Purchase a license key →
							</a>
							<p class="sg-note-sm">Your license key will be emailed to you immediately after purchase.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">5</div>
						<div class="sg-step-body">
							<h3>Activate your license</h3>
							<p>On the Unestra activation screen:</p>
							<ul class="sg-list">
								<li>Enter your <strong>license key</strong> (format: CF-XXXX-XXXX-XXXX-XXXX)</li>
								<li>Enter the <strong>email address</strong> used for purchase</li>
								<li>Click <strong>Activate</strong></li>
							</ul>
							<p>A brief internet connection is required for this step to reach the activation server.</p>
						</div>
					</li>

					<li class="sg-step">
						<div class="sg-step-num" aria-hidden="true">6</div>
						<div class="sg-step-body">
							<h3>Complete the setup wizard</h3>
							<p>After activation, a setup wizard walks through your organization profile, admin account, and initial settings — same as the Windows version.</p>
						</div>
					</li>

				</ol>
			</div><!-- #os-mac -->

		</div><!-- #tab-desktop -->


		<!-- ── FAQ ── -->
		<div class="sg-faq">
			<h2>Frequently asked questions</h2>

			<div class="sg-faq-grid">

				<div class="sg-faq-item">
					<h3>Can I switch between cloud and desktop?</h3>
					<p>Yes. Cloud and desktop are separate products with separate data stores. You can run both under the same organization — for example, using the desktop version in the office and cloud for remote board members.</p>
				</div>

				<div class="sg-faq-item">
					<h3>How many users can I add?</h3>
					<p>Cloud Essential includes 5 seats. Cloud Elite includes unlimited seats (additional seats billed per user). Desktop licenses include 5 seats with additional seats purchasable at $99 each (one-time).</p>
				</div>

				<div class="sg-faq-item">
					<h3>Is my data backed up?</h3>
					<p>Cloud data is automatically backed up daily by Unestra. Desktop data is stored locally — you are responsible for backups. We recommend using the built-in export feature weekly and storing backups offsite.</p>
				</div>

				<div class="sg-faq-item">
					<h3>Can I import data from another system?</h3>
					<p>Yes. Unestra accepts CSV imports for members, dues history, and transactions. Go to <strong>Settings → Import</strong> and download the template for the data type you need to import.</p>
				</div>

				<div class="sg-faq-item">
					<h3>What happens if I lose my license key?</h3>
					<p>Your license key is included in your purchase confirmation email. You can also manage and view your license at <a href="https://api.civicflowapp.com/admin" target="_blank" rel="noopener">api.civicflowapp.com/admin</a>, or contact support.</p>
				</div>

				<div class="sg-faq-item">
					<h3>Does the desktop version need internet?</h3>
					<p>Only for the initial license activation. Once activated, Unestra Desktop runs fully offline. No ongoing internet connection is required for day-to-day use.</p>
				</div>

				<div class="sg-faq-item">
					<h3>Can I try before I buy?</h3>
					<p>Cloud plans offer a free trial — no credit card required. Desktop purchases are covered by a 30-day refund policy; contact support within 30 days of purchase if Unestra doesn't meet your needs.</p>
				</div>

				<div class="sg-faq-item">
					<h3>What is the annual discount?</h3>
					<p>Annual cloud plans save approximately 8% compared to monthly billing. Essential annual is $539/yr (vs $588 monthly). Elite annual is $1,089/yr (vs $1,188 monthly).</p>
				</div>

			</div><!-- .sg-faq-grid -->
		</div><!-- .sg-faq -->


		<!-- ── Support CTA ── -->
		<div class="sg-support">
			<div class="sg-support-inner">
				<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
				<div>
					<h2>Still need help?</h2>
					<p>Our team is here for you. Reach out and we'll get back to you within one business day.</p>
				</div>
				<a href="<?php echo esc_url( home_url( '/#contact' ) ); ?>" class="sg-btn sg-btn-primary">Contact support</a>
			</div>
		</div>

	</div><!-- .container -->
</div><!-- .sg-wrap -->


<style>
/* ─── Setup Guide Styles ─── */
.sg-wrap { background: #f7f9f8; padding-bottom: 5rem; }

/* Hero */
.sg-hero { background: #fff; border-bottom: 1px solid #e5ebe8; padding: 4rem 0 0; text-align: center; }
.sg-eyebrow { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--cf-green, #1D9E75); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 1rem; }
.sg-hero h1 { font-size: clamp(1.9rem, 4vw, 2.6rem); font-weight: 800; letter-spacing: -.03em; margin: 0 auto .75rem; max-width: 640px; }
.sg-hero-sub { color: #5f6f68; font-size: 1.05rem; max-width: 520px; margin: 0 auto 2rem; }

/* Main tabs */
.sg-tabs { display: inline-flex; gap: 4px; background: #f0f4f2; border: 1.5px solid #dde8e3; border-radius: 999px; padding: 4px; margin-bottom: 0; }
.sg-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 22px; border-radius: 999px; border: none; background: transparent; font-size: 14px; font-weight: 600; color: #5f6f68; cursor: pointer; transition: all .18s; }
.sg-tab.active { background: var(--cf-green, #1D9E75); color: #fff; }
.sg-tab:not(.active):hover { background: rgba(29,158,117,.08); color: #1D9E75; }

/* Panels */
.sg-panel { padding-top: 3rem; }
.sg-panel[hidden] { display: none; }

/* Intro row */
.sg-intro-row { display: grid; grid-template-columns: 1fr 340px; gap: 2rem; align-items: start; margin-bottom: 2.5rem; }
.sg-intro-text h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: .5rem; letter-spacing: -.02em; }
.sg-intro-text p { color: #4a5c54; line-height: 1.7; }
.sg-req-box { background: #fff; border: 1.5px solid #dde8e3; border-radius: 12px; padding: 1.25rem 1.5rem; }
.sg-req-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #1D9E75; margin-bottom: .75rem; }
.sg-req-box ul { padding-left: 1.2rem; font-size: 13.5px; color: #3a4a42; line-height: 1.7; }
.sg-req-box li { margin-bottom: .25rem; }

/* Steps */
.sg-steps { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0; }
.sg-step { display: grid; grid-template-columns: 44px 1fr; gap: 1.25rem; padding: 2rem 0; border-bottom: 1px solid #e5ebe8; }
.sg-step:last-child { border-bottom: none; }
.sg-step-num { width: 36px; height: 36px; border-radius: 50%; background: var(--cf-green, #1D9E75); color: #fff; font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
.sg-step-body h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: .5rem; color: #1a2920; }
.sg-step-body p { color: #4a5c54; line-height: 1.75; margin-bottom: .75rem; font-size: 15px; }
.sg-step-body p:last-child { margin-bottom: 0; }
.sg-step-body code { background: #eef3f0; border: 1px solid #d4e3db; padding: 2px 7px; border-radius: 5px; font-family: monospace; font-size: 13px; }

/* Lists */
.sg-list { padding-left: 1.4rem; margin: .5rem 0 .75rem; }
.sg-list li { color: #4a5c54; font-size: 15px; line-height: 1.7; margin-bottom: .3rem; }
.sg-list-alpha { list-style-type: lower-alpha; }
.sg-checklist { list-style: none; padding: 0; margin: .5rem 0; }
.sg-checklist li { display: flex; align-items: center; gap: 10px; color: #2d3d35; font-size: 15px; line-height: 1.6; padding: .35rem 0; }
.sg-check { width: 22px; height: 22px; background: #E1F5EE; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; color: #1D9E75; font-weight: 700; flex-shrink: 0; }

/* Callouts */
.sg-callout { display: flex; align-items: flex-start; gap: 10px; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; font-size: 14px; line-height: 1.6; }
.sg-callout-info { background: #E1F5EE; border: 1px solid #b3e0cc; color: #0F6E56; }
.sg-callout-info svg { color: #1D9E75; flex-shrink: 0; margin-top: 1px; }
.sg-callout-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; }
.sg-callout-warn svg { color: #d97706; flex-shrink: 0; margin-top: 1px; }
.sg-callout a { color: inherit; font-weight: 600; }

/* OS tabs */
.sg-os-tabs { display: flex; gap: 4px; border-bottom: 2px solid #e5ebe8; margin-bottom: 2rem; }
.sg-os-tab { display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px; border: none; background: transparent; font-size: 13.5px; font-weight: 600; color: #7a8f87; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .15s; }
.sg-os-tab.active { color: #1D9E75; border-bottom-color: #1D9E75; }
.sg-os-panel[hidden] { display: none; }

/* Sub-headings inside steps */
.sg-sub-heading { font-weight: 700; color: #1a2920; font-size: 14px; margin: 1.25rem 0 .5rem; }

/* Buttons */
.sg-btn { display: inline-flex; align-items: center; gap: 8px; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all .18s; }
.sg-btn-primary { background: #1D9E75; color: #fff; margin: .5rem 0; }
.sg-btn-primary:hover { background: #168a64; color: #fff; }
.sg-btn-outline { border: 1.5px solid #1D9E75; color: #1D9E75; margin: .5rem 0; }
.sg-btn-outline:hover { background: #1D9E75; color: #fff; }
.sg-dl-row { margin: .75rem 0; }
.sg-note { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #5f6f68; margin-top: .5rem; }
.sg-note-sm { font-size: 13px; color: #7a8f87; margin: .5rem 0 0; }

/* Plan compare */
.sg-plan-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
.sg-plan-card { background: #fff; border: 1.5px solid #dde8e3; border-radius: 12px; padding: 1.25rem 1.5rem; position: relative; }
.sg-plan-popular { border-color: #1D9E75; }
.sg-plan-badge { position: absolute; top: -10px; left: 1rem; background: #1D9E75; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 20px; }
.sg-plan-name { font-size: 15px; font-weight: 700; color: #1a2920; margin-bottom: .25rem; }
.sg-plan-price { font-size: 1.6rem; font-weight: 800; color: #1D9E75; margin-bottom: .75rem; }
.sg-plan-price span { font-size: 14px; font-weight: 500; color: #7a8f87; }
.sg-plan-card ul { padding-left: 1.2rem; font-size: 13.5px; color: #3a4a42; line-height: 1.75; }

/* FAQ */
.sg-faq { padding: 4rem 0; border-top: 1px solid #e5ebe8; margin-top: 2rem; }
.sg-faq > h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 2rem; letter-spacing: -.02em; }
.sg-faq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.sg-faq-item { background: #fff; border: 1.5px solid #e5ebe8; border-radius: 12px; padding: 1.5rem; }
.sg-faq-item h3 { font-size: 15px; font-weight: 700; color: #1a2920; margin-bottom: .5rem; }
.sg-faq-item p { font-size: 14px; color: #4a5c54; line-height: 1.7; }
.sg-faq-item a { color: #1D9E75; }

/* Support */
.sg-support { padding: 3rem 0 0; }
.sg-support-inner { background: #1D9E75; border-radius: 16px; padding: 2.5rem; display: flex; align-items: center; gap: 1.5rem; color: #fff; }
.sg-support-inner svg { flex-shrink: 0; opacity: .9; }
.sg-support-inner div { flex: 1; }
.sg-support-inner h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: .25rem; }
.sg-support-inner p { font-size: 14.5px; opacity: .9; margin: 0; }
.sg-support-inner .sg-btn-primary { background: #fff; color: #1D9E75; white-space: nowrap; }
.sg-support-inner .sg-btn-primary:hover { background: #e1f5ee; }

/* Mobile */
@media (max-width: 700px) {
	.sg-intro-row { grid-template-columns: 1fr; }
	.sg-plan-compare { grid-template-columns: 1fr; }
	.sg-faq-grid { grid-template-columns: 1fr; }
	.sg-support-inner { flex-direction: column; text-align: center; }
	.sg-step { grid-template-columns: 36px 1fr; gap: 1rem; }
	.sg-tabs { flex-direction: column; border-radius: 12px; width: 100%; }
	.sg-tab { border-radius: 8px; justify-content: center; }
	.sg-hero { padding: 2.5rem 0 0; }
}
</style>

<script>
(function () {
	// Main cloud/desktop tabs
	var tabs   = document.querySelectorAll('.sg-tab');
	var panels = document.querySelectorAll('.sg-panel');
	tabs.forEach(function (tab) {
		tab.addEventListener('click', function () {
			var target = tab.dataset.tab;
			tabs.forEach(function (t) {
				var active = t.dataset.tab === target;
				t.classList.toggle('active', active);
				t.setAttribute('aria-selected', active ? 'true' : 'false');
			});
			panels.forEach(function (p) {
				var show = p.id === 'tab-' + target;
				p.classList.toggle('active', show);
				p.hidden = !show;
			});
		});
	});

	// OS sub-tabs inside desktop panel
	var osTabs   = document.querySelectorAll('.sg-os-tab');
	var osPanels = document.querySelectorAll('.sg-os-panel');
	osTabs.forEach(function (tab) {
		tab.addEventListener('click', function () {
			var target = tab.dataset.os;
			osTabs.forEach(function (t) {
				var active = t.dataset.os === target;
				t.classList.toggle('active', active);
				t.setAttribute('aria-selected', active ? 'true' : 'false');
			});
			osPanels.forEach(function (p) {
				var show = p.id === 'os-' + target;
				p.hidden = !show;
			});
		});
	});
})();
</script>

<?php get_footer(); ?>
