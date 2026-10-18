import { LegalLayout } from "./LegalLayout";

const Copyright = () => (
  <LegalLayout title="Copyright & IP Disclaimer" updated="May 14, 2026">
    <p>
      This page covers ownership of the source code, designs, and APK/AAB files generated
      on OneClick Studio, and what you must do to ship them responsibly.
    </p>

    <h2>1. You own your output</h2>
    <p>
      The source code, app icons, designs, and binaries (APK/AAB) generated for your
      project belong to <strong>you</strong>. OneClick Studio claims no IP rights over the
      content of your generated apps and will not redistribute them without your
      permission.
    </p>

    <h2>2. Platform tooling stays ours</h2>
    <p>
      The OneClick Studio platform itself — the AI agent, build pipeline, web app, dashboards,
      and Lovable Cloud integrations — remain the intellectual property of OneClick Studio and
      its licensors. You receive a license to use them, not ownership.
    </p>

    <h2>3. Your responsibility for uploaded assets</h2>
    <p>By uploading a logo, splash image, or any other asset to your project, you confirm:</p>
    <ul>
      <li>You own the asset, or have a license that permits commercial use and distribution.</li>
      <li>The asset does not infringe any trademark, copyright, or right of publicity.</li>
      <li>You have permission to use any brand name you set as the app name.</li>
    </ul>
    <p>
      We do not pre-screen uploads. If a rightful owner sends a valid takedown request,
      we will remove the asset and may suspend the offending account.
    </p>

    <h2>4. Open-source components</h2>
    <p>
      Generated apps include open-source libraries (React, Capacitor, shadcn/ui, etc.).
      Their license texts are bundled with your build output. You must keep these license
      notices when you distribute the APK/AAB.
    </p>

    <h2>5. AI-generated code</h2>
    <p>
      AI models can occasionally produce code that resembles publicly-available examples.
      You are responsible for reviewing AI output before publishing — especially for:
    </p>
    <ul>
      <li>Verbatim copies of copyrighted snippets.</li>
      <li>Code patterns covered by restrictive licenses (GPL, etc.) when you intend a
        permissive distribution.</li>
      <li>Hardcoded API keys or secrets that should not ship.</li>
    </ul>

    <h2>6. Play Store / App Store policies</h2>
    <p>
      If you publish your app on Google Play or other stores, you alone are responsible
      for following their policies (privacy disclosures, content ratings, restricted
      permissions). OneClick Studio does not certify store-readiness.
    </p>

    <h2>7. DMCA / takedown requests</h2>
    <p>
      Rights holders can submit takedown notices through <a href="/support">Support</a>.
      Include the URL or build ID, the work allegedly infringed, and a sworn statement of
      ownership. We act on valid notices promptly.
    </p>

    <h2>8. Trademarks</h2>
    <p>
      "OneClick Studio" and the OneClick Studio logo are our trademarks. You may not use them in your
      generated apps' branding without written permission.
    </p>
  </LegalLayout>
);

export default Copyright;
