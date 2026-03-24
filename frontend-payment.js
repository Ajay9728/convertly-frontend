/**
 * Convertly — Frontend Payment Integration
 * ─────────────────────────────────────────
 * Drop this <script> block into your convertly.html
 * (replaces the existing freemium localStorage logic)
 *
 * Requires: your backend running at BACKEND_URL
 */

// ── Config ────────────────────────────────────────────────────
const BACKEND_URL = "http://localhost:4000"; // change in production

// ── State ────────────────────────────────────────────────────
let userState = {
  isPremium: false,
  subscriptionStatus: null,
  currentPeriodEnd: null,
  dailyConversionsUsed: 0,
  dailyLimit: 5,
  canConvert: true,
};

// ═════════════════════════════════════════════════════════════
//  1. LOAD USER STATUS ON PAGE LOAD
//     Calls GET /api/session-status — reads the httpOnly cookie
//     set by the backend to identify the user.
// ═════════════════════════════════════════════════════════════
async function loadUserStatus() {
  try {
    const params = new URLSearchParams(window.location.search);
    const paymentSuccess = params.get("payment") === "success";
    const paymentCanceled = params.get("payment") === "canceled";

    if (paymentSuccess) {
      localStorage.setItem('conv_premium', 'true');
      userState.isPremium = true;
      userState.canConvert = true;
      window.history.replaceState({}, "", window.location.pathname);
      updateUsageUI();
      showPremiumActivatedModal();
      return;
    }

    if (paymentCanceled) {
      window.history.replaceState({}, "", window.location.pathname);
      showToast("Payment canceled. You can upgrade any time.", "info");
    }

    const res = await fetch(`${BACKEND_URL}/api/session-status`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Status fetch failed");

    userState = await res.json();

    // If backend says premium → save to localStorage
    if (userState.isPremium) {
      localStorage.setItem('conv_premium', 'true');
    }

    // If localStorage says premium → trust it even if backend memory was wiped
    if (localStorage.getItem('conv_premium') === 'true') {
      userState.isPremium = true;
      userState.canConvert = true;
    }

    updateUsageUI();

  } catch (err) {
    console.warn("Could not load user status:", err.message);
    loadFromLocalStorage();
  }
}

// ═════════════════════════════════════════════════════════════
//  2. START STRIPE CHECKOUT
//     Calls POST /api/create-checkout-session
//     Backend returns a Stripe-hosted URL → redirect the user there
// ═════════════════════════════════════════════════════════════
async function startCheckout() {
  // Show loading state on the upgrade button
  const upgradeBtn = document.getElementById("modalUpgradeBtn");
  if (upgradeBtn) {
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = "⏳ Redirecting to payment...";
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/create-checkout-session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Could not start checkout");
    }

    // ✅ Redirect to Stripe Checkout page
    // Stripe handles the payment form, 3DS, receipts, etc.
    window.location.href = data.url;

  } catch (err) {
    console.error("Checkout error:", err.message);
    showToast("Could not start payment. Please try again.", "error");
    if (upgradeBtn) {
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = "Start Premium — $9/mo →";
    }
  }
}

// ═════════════════════════════════════════════════════════════
//  3. RECORD A CONVERSION
//     Call this after every successful file conversion.
//     Backend enforces the free limit server-side.
// ═════════════════════════════════════════════════════════════
async function recordConversion() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/record-conversion`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();

    if (res.status === 403 && data.limitReached) {
      // Server says limit reached
      showLimitModal();
      return false;
    }

    if (!res.ok) throw new Error(data.error);

    // Update local state with remaining count
    if (!userState.isPremium) {
      userState.dailyConversionsUsed++;
      userState.canConvert = data.remaining > 0;
    }
    updateUsageUI();
    return true;

  } catch (err) {
    console.warn("Could not record conversion:", err.message);
    // Fallback: still allow if backend is down (fail open)
    return true;
  }
}

// ═════════════════════════════════════════════════════════════
//  4. OPEN STRIPE BILLING PORTAL
//     Lets the user manage their subscription, update card,
//     download invoices, cancel — all handled by Stripe.
// ═════════════════════════════════════════════════════════════
async function openBillingPortal() {
  showToast("Opening billing portal...", "info");

  try {
    const res = await fetch(`${BACKEND_URL}/api/create-portal-session`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    window.location.href = data.url;
  } catch (err) {
    showToast("Could not open billing portal. Please try again.", "error");
  }
}

// ═════════════════════════════════════════════════════════════
//  5. CANCEL SUBSCRIPTION
//     Cancels at end of billing period — user keeps access
// ═════════════════════════════════════════════════════════════
async function cancelSubscription() {
  if (!confirm("Cancel your Premium subscription? You'll keep access until the end of your billing period.")) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/cancel-subscription`, {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message, "success");
  } catch (err) {
    showToast("Could not cancel subscription. Contact support.", "error");
  }
}

// ═════════════════════════════════════════════════════════════
//  UI HELPERS
// ═════════════════════════════════════════════════════════════

function updateUsageUI() {
  const { isPremium, dailyConversionsUsed, dailyLimit, subscriptionStatus } = userState;
  const remaining = isPremium ? Infinity : Math.max(0, dailyLimit - dailyConversionsUsed);

  const usageText = document.getElementById("usageText");
  const usageDot  = document.getElementById("usageDot");
  const limitBar  = document.getElementById("limitBar");
  const limitCount = document.getElementById("limitCount");

  if (isPremium) {
    usageText.textContent = "⭐ Premium — Unlimited";
    usageDot.style.background = "var(--blue)";
    if (limitBar) limitBar.classList.remove("show");

    // Show billing portal link in nav
    injectManageBillingLink();
    return;
  }

  usageText.textContent = `${remaining} free conversion${remaining !== 1 ? "s" : ""} left today`;
  limitCount.textContent = dailyConversionsUsed;

  if (remaining === 0) {
    usageDot.className = "dot danger";
    limitBar?.classList.add("show");
  } else if (remaining <= 2) {
    usageDot.className = "dot warn";
    if (dailyConversionsUsed >= 3) limitBar?.classList.add("show");
  }
}

function injectManageBillingLink() {
  if (document.getElementById("manageBillingBtn")) return;
  const navLinks = document.querySelector(".nav-links");
  if (!navLinks) return;
  const btn = document.createElement("button");
  btn.id = "manageBillingBtn";
  btn.className = "nav-link";
  btn.textContent = "Manage Billing";
  btn.onclick = openBillingPortal;
  navLinks.appendChild(btn);
}

function showPremiumActivatedModal() {
  document.getElementById("premiumModal")?.classList.add("show");
}

function showToast(message, type = "info") {
  // Remove existing toast
  document.getElementById("toast")?.remove();

  const colors = { success: "#10B981", error: "#EF4444", info: "#2563EB" };
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${colors[type]};color:white;
    padding:14px 20px;border-radius:10px;
    font-size:14px;font-weight:500;font-family:var(--font-body);
    box-shadow:0 8px 32px rgba(0,0,0,0.15);
    animation:slideIn .3s ease;max-width:360px;line-height:1.5;
  `;
  toast.textContent = message;

  const style = document.createElement("style");
  style.textContent = `@keyframes slideIn{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}`;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

// ── Fallback: localStorage if backend is unreachable ─────────
function loadFromLocalStorage() {
  const today = new Date().toDateString();
  const raw = JSON.parse(localStorage.getItem("conv_day_" + today) || "0");
  userState = {
    isPremium: localStorage.getItem("conv_premium") === "true",
    dailyConversionsUsed: raw,
    dailyLimit: 5,
    canConvert: raw < 5,
    subscriptionStatus: null,
    currentPeriodEnd: null,
  };
  updateUsageUI();
}

// ═════════════════════════════════════════════════════════════
//  OVERRIDE: Hook into the existing doConvert() function
//  Add this inside your existing doConvert() function,
//  right after the conversion succeeds:
//
//    const allowed = await recordConversion();
//    if (!allowed) return; // limit reached
//
// ═════════════════════════════════════════════════════════════

// ── Wire up the upgrade button ────────────────────────────────
// Replace the onclick in your upgrade modal button with:
//   onclick="startCheckout()"

// ── Init ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadUserStatus);
