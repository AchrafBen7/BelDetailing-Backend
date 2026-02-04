# Annulation des réservations et versement au détaileur

## 1. Frais NIOS = 5 % du prix du **service** uniquement (min 10 €)

Les frais de gestion NIOS sont calculés sur le **prix du service** (sans les frais de transport), minimum 10 €.

### Situation 1 : Entre 24 h et 48 h avant le service

- **Remboursé au client :** total − frais NIOS (5 % du service, min 10 €). Transport remboursé.
- **Retenu par NIOS :** `max(5 % du prix service, 10 €)`.

Exemple (300 € service + 20 € transport = 320 €) : frais NIOS = 5 % de 300 = 15 € → client remboursé 305 €, NIOS garde 15 €.

### Situation 2 : Moins de 24 h avant le service

- **Transport (20 €) :** gardé par le **détaileur** (non remboursé au client).
- **Frais NIOS :** 5 % du **prix du service** = `max(5 % × 300, 10 €)` = 15 €, gardés par NIOS.
- **Remboursé au client :** **service − frais NIOS** = 300 − 15 = **285 €**.

Exemple (300 € service + 20 € transport = 320 €) : client remboursé **285 €**, détaileur garde 20 € (transport), NIOS garde 15 €.

Le calcul est dans `calculateRefundAmount()` (booking.controller.js).

---

## 2. Moment où le détaileur reçoit l’argent de la réservation

- **À la confirmation** : le paiement est **capturé** sur la plateforme et la **commission NIOS (10 %)** reste sur le compte plateforme. L’argent du détaileur **n’est pas envoyé tout de suite** : il est **gelé** sur la plateforme.
- **3 h après l’heure (et le jour) de la réservation** : un **cron** exécute le **Transfer** Stripe vers le compte Connect du détaileur (montant total − 10 %). Le détaileur reçoit alors sa part, selon le cycle de payout Stripe (ex. J+2, J+7).

Résumé :
1. Client paie (préautorisation).
2. Prestataire **confirme** → `POST /bookings/:id/confirm` → **capture** sur la plateforme (commission 10 % NIOS gardée).
3. **3 h après** la date/heure de la résa → cron `transferBookingToProvider` → **Transfer** vers le compte Connect du détaileur (90 % du montant).

---

## 3. Constantes (alignées backend / iOS)

- **Frais de gestion annulation :** 5 % du **prix du service** (sans transport), minimum 10 € (`NIOS_MANAGEMENT_FEE_RATE`, `NIOS_MANAGEMENT_FEE_MIN` dans booking.controller.js).
- **Commission réservation (capture) :** 10 % (`BOOKING_COMMISSION_RATE` dans config/commission.js).
