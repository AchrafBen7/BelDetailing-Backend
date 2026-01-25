# 🧩 Implémentation du Rôle "Detailer Passionné"

## 📋 Vue d'ensemble

Ce document décrit l'implémentation complète du nouveau rôle **"Detailer Passionné"** qui permet à des passionnés d'automobile de proposer leurs services aux particuliers uniquement, sans TVA, sans Stripe Connect, et avec un plafond annuel pour éviter le travail au noir.

---

## 🎯 Objectifs

- ✅ Permettre l'inscription sans TVA
- ✅ Limiter aux clients particuliers uniquement
- ✅ Bloquer l'accès aux offres/missions B2B
- ✅ Bloquer SEPA et Stripe Connect
- ✅ Autoriser uniquement les paiements carte
- ✅ Implémenter un plafond annuel (2000€)
- ✅ Permettre la transition vers Detailer Pro

---

## 🗄️ 1. MODIFICATIONS BASE DE DONNÉES

### 1.1 Nouveau rôle dans `users`

**✅ Option A : Nouveau rôle séparé** (choisi)
```sql
-- Migration: add_provider_passionate_role.sql
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('customer', 'company', 'provider', 'provider_passionate'));
```

**Note :** L'Option B (flag is_professional) n'est pas utilisée. On utilise l'Option A pour une séparation claire.

### 1.2 Plafond annuel dans `provider_profiles`

```sql
-- Migration: add_annual_revenue_tracking.sql
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS annual_revenue_limit DECIMAL(10,2) DEFAULT 2000.00, -- ✅ Plafond à 2000€
ADD COLUMN IF NOT EXISTS annual_revenue_current DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS annual_revenue_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW());

-- Index pour les requêtes de plafond
CREATE INDEX IF NOT EXISTS idx_provider_profiles_annual_revenue
ON provider_profiles(annual_revenue_year, annual_revenue_current)
WHERE annual_revenue_limit IS NOT NULL;
```

### 1.3 Mise à jour des contraintes CHECK

```sql
-- Migration: update_messages_sender_role_check.sql
ALTER TABLE messages
DROP CONSTRAINT IF EXISTS messages_sender_role_check;

ALTER TABLE messages
ADD CONSTRAINT messages_sender_role_check
CHECK (sender_role IN ('provider', 'provider_passionate', 'customer', 'company'));
```

---

## 🔐 2. MODIFICATIONS BACKEND - AUTHENTIFICATION

### 2.1 Inscription (`auth.controller.js`)

**Modification :** Permettre l'inscription sans TVA pour `provider_passionate`

```javascript
// src/controllers/auth.controller.js
export async function register(req, res) {
  const { email, password, role, phone, vat_number } = req.body;
  
  const finalRole = (role || "customer").toLowerCase();
  
  // ✅ NOUVEAU : provider_passionate n'a PAS besoin de TVA
  if (finalRole === "provider_passionate") {
    // Pas de vérification TVA pour les passionnés
  } else if ((finalRole === "provider" || finalRole === "company") && !vat_number) {
    return res.status(400).json({
      error: "VAT number is required for providers and companies."
    });
  }
  
  // ... reste du code
}
```

### 2.2 Création du profil provider_passionate

```javascript
// Dans register() après création du user
if (finalRole === "provider_passionate") {
  const { error: provProfileErr } = await supabaseAdmin
    .from("provider_profiles")
    .insert({
      user_id: authUser.id,
      display_name: authUser.email.split("@")[0],
      bio: "",
      base_city: "",
      postal_code: "",
      lat: 0,
      lng: 0,
      has_mobile_service: false,
      min_price: 0,
      rating: 0,
      review_count: 0,
      services: [],
      team_size: 1,
      years_of_experience: 0,
      logo_url: null,
      banner_url: null,
      annual_revenue_limit: 2000.00, // ✅ Plafond à 2000€
      annual_revenue_current: 0.00,
      annual_revenue_year: new Date().getFullYear(),
    });
}
```

---

## 🚫 3. MODIFICATIONS BACKEND - BLOCAGES B2B

### 3.1 Bloquer l'accès aux offres (`application.controller.js`)

```javascript
// src/controllers/application.controller.js
export async function applyToOfferController(req, res) {
  try {
    // ✅ BLOQUER les passionnés
    if (req.user.role === "provider_passionate") {
      return res.status(403).json({ 
        error: "Passionate detailers cannot apply to offers. Please upgrade to Pro account (VAT required)." 
      });
    }
    
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can apply" });
    }
    
    // ... reste du code
  }
}
```

### 3.2 Bloquer l'accès aux missions (`missionAgreementUpdate.service.js`)

```javascript
// src/services/missionAgreementUpdate.service.js
export async function acceptMissionAgreementByDetailer(id, userId) {
  // ✅ Vérifier que l'utilisateur n'est PAS un passionné
  const { data: user } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();
  
  if (user?.role === "provider_passionate") {
    throw new Error("Passionate detailers cannot accept mission agreements. Please upgrade to Pro account (VAT required).");
  }
  
  // ... reste du code
}
```

### 3.3 Masquer les offres dans `getOffers` (optionnel - côté iOS)

Le backend peut retourner les offres, mais l'iOS ne les affichera pas pour les passionnés.

---

## 💳 4. MODIFICATIONS BACKEND - PAIEMENTS

### 4.1 Bloquer SEPA (`sepaDirectDebit.service.js`)

```javascript
// src/services/sepaDirectDebit.service.js
export async function createSepaSetupIntent(companyUserId) {
  // ✅ Vérifier que l'utilisateur n'est PAS un passionné
  const { data: user } = await supabase
    .from("users")
    .select("role")
    .eq("id", companyUserId)
    .single();
  
  if (user?.role === "provider_passionate") {
    throw new Error("Passionate detailers cannot use SEPA Direct Debit. Please upgrade to Pro account (VAT required).");
  }
  
  // ... reste du code
}
```

### 4.2 Bloquer Stripe Connect (`stripeConnect.controller.js`)

```javascript
// src/controllers/stripeConnect.controller.js
export async function createOrGetAccountController(req, res) {
  try {
    // ✅ BLOQUER les passionnés
    if (req.user.role === "provider_passionate") {
      return res.status(403).json({ 
        error: "Passionate detailers cannot use Stripe Connect. Please upgrade to Pro account (VAT required)." 
      });
    }
    
    if (req.user.role !== "provider") {
      return res.status(403).json({ error: "Only providers can have Stripe accounts" });
    }
    
    // ... reste du code
  }
}
```

### 4.3 Vérifier le plafond annuel (`booking.controller.js`)

```javascript
// src/controllers/booking.controller.js
export async function createBooking(req, res) {
  try {
    const customerId = req.user.id;
    
    // ✅ Vérifier le plafond pour les passionnés
    if (req.user.role === "provider_passionate") {
      const { data: providerProfile } = await supabase
        .from("provider_profiles")
        .select("annual_revenue_limit, annual_revenue_current, annual_revenue_year")
        .eq("user_id", req.body.provider_id)
        .single();
      
      if (providerProfile) {
        const currentYear = new Date().getFullYear();
        const isNewYear = providerProfile.annual_revenue_year !== currentYear;
        
        // Réinitialiser si nouvelle année
        if (isNewYear) {
          await supabase
            .from("provider_profiles")
            .update({
              annual_revenue_current: 0,
              annual_revenue_year: currentYear,
            })
            .eq("user_id", req.body.provider_id);
        }
        
        const newRevenue = (providerProfile.annual_revenue_current || 0) + req.body.price;
        const limit = providerProfile.annual_revenue_limit || 2000; // ✅ Plafond à 2000€
        
        if (newRevenue > limit) {
          return res.status(403).json({
            error: `Annual revenue limit reached (${limit}€). Please upgrade to Pro account (VAT required) to continue.`
          });
        }
      }
    }
    
    // ... reste du code pour créer le booking
  }
}
```

### 4.4 Mettre à jour le revenu annuel (webhook `payment_intent.succeeded`)

```javascript
// src/routes/stripeWebhook.routes.js
case "payment_intent.succeeded": {
  // ... code existant
  
  // ✅ Mettre à jour le revenu annuel pour les passionnés
  if (bookingId) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("provider_id, price")
      .eq("id", bookingId)
      .single();
    
    if (booking) {
      const { data: provider } = await supabase
        .from("provider_profiles")
        .select("user_id, annual_revenue_current, annual_revenue_year")
        .eq("user_id", booking.provider_id)
        .single();
      
      if (provider) {
        const { data: user } = await supabase
          .from("users")
          .select("role")
          .eq("id", booking.provider_id)
          .single();
        
        if (user?.role === "provider_passionate") {
          const currentYear = new Date().getFullYear();
          const isNewYear = provider.annual_revenue_year !== currentYear;
          
          await supabase
            .from("provider_profiles")
            .update({
              annual_revenue_current: isNewYear 
                ? booking.price 
                : (provider.annual_revenue_current || 0) + booking.price,
              annual_revenue_year: currentYear,
            })
            .eq("user_id", booking.provider_id);
        }
      }
    }
  }
  
  break;
}
```

---

## 🔄 5. TRANSITION VERS DETAILER PRO

### 5.1 Endpoint de mise à jour (`profile.controller.js`)

```javascript
// src/controllers/profile.controller.js
export async function updateProfile(req, res) {
  const userId = req.user?.id;
  const { vatNumber, role } = req.body;
  
  // ✅ TRANSITION : Si un passionné ajoute une TVA, passer en Pro
  if (req.user.role === "provider_passionate" && vatNumber && vatNumber.trim() !== "") {
    // Vérifier que la TVA est valide (appel à un service de validation)
    const { validateVAT } = await import("../services/vatValidation.service.js");
    const isValid = await validateVAT(vatNumber);
    
    if (!isValid) {
      return res.status(400).json({ error: "Invalid VAT number" });
    }
    
    // Mettre à jour le rôle
    const { error: roleError } = await supabase
      .from("users")
      .update({
        role: "provider",
        vat_number: vatNumber,
        is_vat_valid: true,
      })
      .eq("id", userId);
    
    if (roleError) {
      return res.status(500).json({ error: roleError.message });
    }
    
    // Réinitialiser le plafond (plus nécessaire pour les Pros)
    await supabase
      .from("provider_profiles")
      .update({
        annual_revenue_limit: null,
        annual_revenue_current: null,
        annual_revenue_year: null,
      })
      .eq("user_id", userId);
    
    // Retourner le profil mis à jour
    return await getProfile(req, res);
  }
  
  // ... reste du code
}
```

---

## 📱 6. MODIFICATIONS iOS

### 6.1 Ajouter le nouveau rôle (`User.swift`)

```swift
// BelDetailing/Models/User.swift
enum UserRole: String, Codable, CaseIterable { 
  case customer
  case company
  case provider
  case providerPassionate = "provider_passionate" // ✅ NOUVEAU
}
```

### 6.2 Masquer la page des offres (`OffersView.swift`)

```swift
// BelDetailing/Views/Offers/OffersView.swift
struct OffersView: View {
  @EnvironmentObject var engine: Engine
  
  var body: some View {
    // ✅ Masquer pour les passionnés
    if engine.userService.fullUser?.role == .providerPassionate {
      PassionateDetailerOffersBlockedView()
    } else {
      // Vue normale des offres
      OffersContentView()
    }
  }
}

private struct PassionateDetailerOffersBlockedView: View {
  var body: some View {
    VStack(spacing: 20) {
      Image(systemName: "lock.fill")
        .font(.system(size: 60))
        .foregroundColor(.gray)
      
      Text("Offres B2B non disponibles")
        .font(.title2)
        .fontWeight(.bold)
      
      Text("En tant que Detailer Passionné, vous ne pouvez pas répondre aux offres d'entreprises.\n\nPour accéder aux offres, passez en compte Pro (TVA requise).")
        .multilineTextAlignment(.center)
        .foregroundColor(.gray)
      
      Button("Passer en compte Pro") {
        // Navigation vers la page de mise à jour du profil
      }
      .buttonStyle(.borderedProminent)
    }
    .padding()
  }
}
```

### 6.3 Badge "Passionné" (`ProviderCardView.swift`)

```swift
// Dans la vue de carte provider
if provider.userRole == .providerPassionate {
  HStack {
    Text("Detailer Passionné")
      .font(.caption)
      .fontWeight(.semibold)
      .foregroundColor(.orange)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(Color.orange.opacity(0.1))
      .cornerRadius(8)
    
    Text("Clients particuliers uniquement")
      .font(.caption2)
      .foregroundColor(.gray)
  }
}
```

---

## 📊 7. RÉSUMÉ DES MODIFICATIONS

### Backend
- ✅ Migration SQL : nouveau rôle `provider_passionate`
- ✅ Migration SQL : plafond annuel dans `provider_profiles`
- ✅ `auth.controller.js` : inscription sans TVA
- ✅ `application.controller.js` : bloquer applyToOffer
- ✅ `missionAgreementUpdate.service.js` : bloquer acceptMissionAgreement
- ✅ `sepaDirectDebit.service.js` : bloquer SEPA
- ✅ `stripeConnect.controller.js` : permettre Stripe Connect Individual pour passionnés
- ✅ `stripeConnect.service.js` : créer compte Individual pour passionnés
- ✅ `payment.service.js` : utiliser application_fee_amount pour commission NIOS
- ✅ `booking.controller.js` : vérifier plafond annuel
- ✅ `stripeWebhook.routes.js` : mettre à jour revenu annuel
- ✅ `profile.controller.js` : transition vers Pro

### iOS
- ✅ `User.swift` : ajouter `providerPassionate`
- ✅ `OffersView.swift` : masquer pour les passionnés
- ✅ Badge "Passionné" dans les vues provider
- ✅ Message de blocage avec CTA vers Pro

---

## 🧪 8. TESTS À EFFECTUER

1. ✅ Inscription sans TVA → rôle `provider_passionate`
2. ✅ Tentative d'application à une offre → erreur 403
3. ✅ Tentative d'acceptation de mission → erreur 403
4. ✅ Tentative de setup SEPA → erreur 403
5. ✅ Tentative de Stripe Connect → erreur 403
6. ✅ Création de booking → vérification plafond
7. ✅ Atteinte du plafond → blocage avec message
8. ✅ Ajout de TVA → transition vers `provider`
9. ✅ iOS : page offres masquée pour passionnés
10. ✅ iOS : badge "Passionné" visible

---

## 🚀 9. ORDRE D'IMPLÉMENTATION

1. **Phase 1 : Base de données**
   - Créer les migrations SQL
   - Tester les contraintes

2. **Phase 2 : Backend - Blocages**
   - Implémenter les blocages B2B
   - Implémenter les blocages SEPA/Stripe Connect

3. **Phase 3 : Backend - Plafond**
   - Implémenter la vérification du plafond
   - Implémenter la mise à jour du revenu annuel

4. **Phase 4 : Backend - Transition**
   - Implémenter la transition vers Pro

5. **Phase 5 : iOS**
   - Ajouter le rôle
   - Masquer les offres
   - Ajouter le badge

---

## ⚠️ 10. POINTS D'ATTENTION

- **Plafond annuel** : Réinitialiser au 1er janvier de chaque année
- **Transition Pro** : Ne pas perdre les données existantes (bookings, reviews, etc.)
- **UX** : Messages clairs pour expliquer les limitations
- **Sécurité** : Vérifications côté backend, pas seulement côté iOS
- **Logs** : Logger toutes les tentatives de contournement

---

## 📝 11. NOTES FINALES

- Le rôle `provider_passionate` est un **rôle d'entrée**, pas un rôle professionnel
- La transition vers Pro doit être **fluide et sans friction**
- Le plafond annuel est **fixé à 2000€** pour les provider_passionate
- Toutes les limitations sont **techniques**, pas seulement visuelles
