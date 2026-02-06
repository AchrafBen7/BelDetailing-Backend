// src/controllers/admin.controller.js
// Admin Dashboard — Un seul endpoint qui retourne TOUTES les stats
// Protege par requireAuth + role === "admin"

import { supabaseAdmin as supabase } from "../config/supabase.js";

/**
 * GET /api/v1/admin/dashboard
 * Retourne un JSON complet avec toutes les donnees admin.
 */
export async function getAdminDashboard(req, res) {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Execute toutes les requetes en parallele
    const [
      usersResult,
      bookingsResult,
      bookingsThisMonthResult,
      revenueResult,
      transactionsResult,
      providersResult,
      reportsResult,
      missionsResult,
      missionPaymentsResult,
      cronLocksResult,
      recentBookingsResult,
      refundsResult,
      registrationsWeekResult,
      activeUsers7dResult,
      activeUsers30dResult,
    ] = await Promise.all([
      // 1. Total users par role
      supabase.from("users").select("id, role, created_at"),

      // 2. Tous les bookings (stats par statut)
      supabase.from("bookings").select("id, status, payment_status, price, provider_id, customer_id, created_at"),

      // 3. Bookings ce mois
      supabase.from("bookings").select("id, price, payment_status, created_at")
        .gte("created_at", startOfMonth),

      // 4. Revenue (bookings payes ce mois)
      supabase.from("bookings").select("price, commission_rate")
        .eq("payment_status", "paid")
        .gte("created_at", startOfMonth),

      // 5. Transactions recentes (10 dernieres)
      supabase.from("payment_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),

      // 6. Providers avec stats
      supabase.from("provider_profiles")
        .select("user_id, display_name, rating, review_count, stripe_account_id"),

      // 7. Reports non-traites
      supabase.from("content_reports")
        .select("id, content_type, reason, status, created_at")
        .eq("status", "pending"),

      // 8. Missions actives
      supabase.from("mission_agreements")
        .select("id, status, final_price, company_id, detailer_id, start_date, end_date, payment_status"),

      // 9. Mission payments
      supabase.from("mission_payments")
        .select("id, type, amount, status, scheduled_date, mission_agreement_id"),

      // 10. Cron locks (dernier run)
      supabase.from("cron_locks")
        .select("job_name, locked_at, locked_by")
        .order("locked_at", { ascending: false }),

      // 11. Bookings recents (15 derniers)
      supabase.from("bookings")
        .select("id, provider_name, service_name, price, status, payment_status, date, created_at")
        .order("created_at", { ascending: false })
        .limit(15),

      // 12. Refunds en cours
      supabase.from("bookings")
        .select("id, price, payment_status, provider_name, created_at")
        .eq("payment_status", "refunded"),

      // 13. Inscriptions cette semaine
      supabase.from("users")
        .select("id, role, created_at")
        .gte("created_at", startOfWeek),

      // 14. Users actifs 7j (bookings crees cette semaine)
      supabase.from("bookings")
        .select("customer_id")
        .gte("created_at", startOfWeek),

      // 15. Users actifs 30j
      supabase.from("bookings")
        .select("customer_id")
        .gte("created_at", startOf30Days),
    ]);

    // ============================================================
    // PROCESS DATA
    // ============================================================

    const users = usersResult.data || [];
    const bookings = bookingsResult.data || [];
    const bookingsThisMonth = bookingsThisMonthResult.data || [];
    const revenue = revenueResult.data || [];
    const providers = providersResult.data || [];
    const reports = reportsResult.data || [];
    const missions = missionsResult.data || [];
    const missionPayments = missionPaymentsResult.data || [];
    const registrationsWeek = registrationsWeekResult.data || [];

    // 1. KPIs
    const totalRevenue = revenue.reduce((sum, b) => sum + Number(b.price || 0), 0);
    const totalCommissions = revenue.reduce((sum, b) => {
      const rate = Number(b.commission_rate || 0.10);
      return sum + Number(b.price || 0) * rate;
    }, 0);

    // 2. Users by role
    const usersByRole = {};
    users.forEach((u) => {
      usersByRole[u.role] = (usersByRole[u.role] || 0) + 1;
    });

    // 3. Bookings by status
    const bookingsByStatus = {};
    bookings.forEach((b) => {
      bookingsByStatus[b.status] = (bookingsByStatus[b.status] || 0) + 1;
    });

    // 4. Active users
    const activeUsers7d = new Set((activeUsers7dResult.data || []).map((b) => b.customer_id)).size;
    const activeUsers30d = new Set((activeUsers30dResult.data || []).map((b) => b.customer_id)).size;

    // 5. Top providers by revenue
    const providerRevenue = {};
    bookings
      .filter((b) => b.payment_status === "paid")
      .forEach((b) => {
        const pid = b.provider_id;
        providerRevenue[pid] = (providerRevenue[pid] || 0) + Number(b.price || 0);
      });

    const topProviders = providers
      .map((p) => ({
        userId: p.user_id,
        displayName: p.display_name,
        rating: p.rating,
        reviewCount: p.review_count,
        stripeOnboarded: !!p.stripe_account_id,
        revenue: providerRevenue[p.user_id] || 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const providersNotOnboarded = providers.filter((p) => !p.stripe_account_id).length;

    // 6. Missions B2B
    const activeMissions = missions.filter((m) => m.status === "active");
    const missionTotalValue = activeMissions.reduce((sum, m) => sum + Number(m.final_price || 0), 0);

    const pendingPayments = missionPayments.filter((p) => p.status === "pending" || p.status === "authorized");
    const failedPayments = missionPayments.filter((p) => p.status === "failed");

    // 7. Registrations this week
    const registrationsByRole = {};
    registrationsWeek.forEach((u) => {
      registrationsByRole[u.role] = (registrationsByRole[u.role] || 0) + 1;
    });

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.json({
      timestamp: new Date().toISOString(),

      // 1. KPIs Header
      kpis: {
        monthlyRevenue: Math.round(totalRevenue * 100) / 100,
        monthlyCommissions: Math.round(totalCommissions * 100) / 100,
        totalBookingsThisMonth: bookingsThisMonth.length,
        totalUsers: users.length,
        newUsersThisWeek: registrationsWeek.length,
      },

      // 2. Users
      users: {
        total: users.length,
        byRole: usersByRole,
        registrationsThisWeek: registrationsByRole,
        activeUsers7d,
        activeUsers30d,
      },

      // 3. Bookings
      bookings: {
        total: bookings.length,
        byStatus: bookingsByStatus,
        recent: (recentBookingsResult.data || []).map((b) => ({
          id: b.id,
          providerName: b.provider_name,
          serviceName: b.service_name,
          price: b.price,
          status: b.status,
          paymentStatus: b.payment_status,
          date: b.date,
          createdAt: b.created_at,
        })),
      },

      // 4. Revenue
      revenue: {
        thisMonth: Math.round(totalRevenue * 100) / 100,
        commissions: Math.round(totalCommissions * 100) / 100,
        net: Math.round((totalRevenue - totalCommissions) * 100) / 100,
      },

      // 5. Payments
      payments: {
        recentTransactions: (transactionsResult.data || []).map((t) => ({
          id: t.id,
          amount: t.amount,
          currency: t.currency,
          status: t.status,
          type: t.type,
          createdAt: t.created_at,
        })),
        refunds: (refundsResult.data || []).map((b) => ({
          id: b.id,
          price: b.price,
          providerName: b.provider_name,
          createdAt: b.created_at,
        })),
        refundsCount: (refundsResult.data || []).length,
      },

      // 6. Providers
      providers: {
        total: providers.length,
        notOnboardedStripe: providersNotOnboarded,
        topByRevenue: topProviders,
      },

      // 7. Moderation
      moderation: {
        pendingReports: reports.length,
        reports: reports.map((r) => ({
          id: r.id,
          contentType: r.content_type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      },

      // 8. Missions B2B
      missions: {
        active: activeMissions.length,
        totalValue: Math.round(missionTotalValue * 100) / 100,
        pendingPayments: pendingPayments.length,
        failedPayments: failedPayments.length,
        byStatus: missions.reduce((acc, m) => {
          acc[m.status] = (acc[m.status] || 0) + 1;
          return acc;
        }, {}),
      },

      // 9. System / Crons
      system: {
        uptime: process.uptime(),
        nodeEnv: process.env.NODE_ENV || "development",
        cronJobs: (cronLocksResult.data || []).map((l) => ({
          job: l.job_name,
          lastRun: l.locked_at,
          instance: l.locked_by,
        })),
      },
    });
  } catch (err) {
    console.error("[ADMIN] dashboard error:", err);
    return res.status(500).json({ error: "Could not fetch admin dashboard" });
  }
}
