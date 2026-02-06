import axios from "axios";
import { XMLParser } from "fast-xml-parser";

const VIES_URL =
  "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";

function normalizeVatNumber(vatNumber) {
  const normalized = vatNumber.replace(/\s/g, "").toUpperCase();
  if (normalized.startsWith("BE")) {
    return { countryCode: "BE", number: normalized.slice(2) };
  }
  if (normalized.length >= 9) {
    return { countryCode: "BE", number: normalized };
  }
  return null;
}

function parseAddress(address) {
  if (!address) {
    return { city: null, postalCode: null };
  }

  const cleanAddress = address.replace(/\n/g, " ").trim();
  const parts = cleanAddress.split(",");
  const lastPart = parts.length >= 2 ? parts[parts.length - 1].trim() : cleanAddress;
  const postalMatch = lastPart.match(/\b(\d{4})\b/);

  if (postalMatch) {
    return {
      postalCode: postalMatch[1],
      city: lastPart.replace(/\d{4}\s*/, "").trim() || null,
    };
  }

  return { city: lastPart.trim() || null, postalCode: null };
}

export async function lookupVAT(vatNumber) {
  const normalized = normalizeVatNumber(vatNumber ?? "");
  if (!normalized) {
    return {
      valid: false,
      error: "Format de numero de TVA invalide",
    };
  }

  const { countryCode, number } = normalized;

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <countryCode>${countryCode}</countryCode>
      <vatNumber>${number}</vatNumber>
    </checkVat>
  </soap:Body>
</soap:Envelope>`;

  try {
    // 🛡️ SÉCURITÉ : Masquer le numéro TVA (PII) en production
    const maskedNumber = process.env.NODE_ENV === "production" 
      ? `${countryCode}${number.slice(0, 4)}****` 
      : `${countryCode}${number}`;
    console.log(`🔍 [VAT] Calling VIES for ${maskedNumber}`);

    const response = await axios.post(VIES_URL, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      timeout: 10000,
    });

    console.log(`📦 [VAT] VIES Response status: ${response.status}`);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "_text",
      isArray: () => false,
    });

    const xmlData = parser.parse(response.data);

    let checkVatResponse =
      xmlData["env:Envelope"]?.["env:Body"]?.["ns2:checkVatResponse"] ||
      xmlData["soap:Envelope"]?.["soap:Body"]?.["checkVatResponse"] ||
      xmlData["soap:Envelope"]?.["soap:Body"]?.["ns2:checkVatResponse"] ||
      xmlData["Envelope"]?.["Body"]?.["checkVatResponse"] ||
      xmlData["soapenv:Envelope"]?.["soapenv:Body"]?.["checkVatResponse"];

    if (!checkVatResponse) {
      console.error("❌ [VAT] Cannot find checkVatResponse in XML structure");
      console.error("❌ [VAT] Available keys:", Object.keys(xmlData));

      const fault =
        xmlData["env:Envelope"]?.["env:Body"]?.["env:Fault"] ||
        xmlData["soap:Envelope"]?.["soap:Body"]?.["soap:Fault"] ||
        xmlData["soap:Envelope"]?.["soap:Body"]?.["Fault"] ||
        xmlData["soap:Envelope"]?.["soap:Body"]?.["soapenv:Fault"];

      if (fault) {
        const faultString =
          fault["faultstring"]?._text ||
          fault["faultstring"] ||
          fault["faultString"]?._text ||
          fault["faultString"] ||
          fault["soap:FaultString"]?._text ||
          fault["soap:FaultString"] ||
          fault["soapenv:faultstring"]?._text ||
          fault["soapenv:faultstring"] ||
          fault["env:faultstring"]?._text ||
          fault["env:faultstring"];
        console.error("❌ [VAT] SOAP Fault detected:", faultString);
        return {
          valid: false,
          error: faultString || "Erreur lors de la verification VIES",
        };
      }

      return {
        valid: false,
        error: "Reponse VIES invalide",
      };
    }

    const valid =
      checkVatResponse["ns2:valid"] === "true" ||
      checkVatResponse["ns2:valid"] === true ||
      checkVatResponse.valid === "true" ||
      checkVatResponse.valid === true ||
      checkVatResponse.valid?._text === "true";

    const name =
      checkVatResponse["ns2:name"] ||
      checkVatResponse.name?._text ||
      checkVatResponse.name ||
      null;

    const address =
      checkVatResponse["ns2:address"] ||
      checkVatResponse.address?._text ||
      checkVatResponse.address ||
      null;

    // 🛡️ SÉCURITÉ : Masquer les infos personnelles (nom, adresse) en production
    if (process.env.NODE_ENV === "production") {
      console.log(`✅ [VAT] Valid: ${valid}`);
    } else {
      console.log(`✅ [VAT] Valid: ${valid}, Name: ${name}, Address: ${address}`);
    }

    if (!valid) {
      return {
        valid: false,
        error: "Numero de TVA non reconnu en Belgique",
      };
    }

    const { city, postalCode } = parseAddress(address);

    return {
      valid: true,
      companyName: name,
      address,
      city,
      postalCode,
      country: countryCode,
      vatNumber: `${countryCode}${number}`,
    };
  } catch (error) {
    console.error("[VAT] VIES API error:", error.message);
    if (error.response) {
      console.error("[VAT] Error response status:", error.response.status);
      console.error(
        "[VAT] Error response data (first 500 chars):",
        error.response.data?.substring(0, 500)
      );
    }

    if (error.code === "ECONNABORTED" || error.response?.status >= 500) {
      return {
        valid: false,
        error:
          "Service de verification temporairement indisponible. Veuillez reessayer plus tard.",
        retryable: true,
      };
    }

    return {
      valid: false,
      error: "Impossible de verifier le numero de TVA",
    };
  }
}

export async function validateVATNumber(vatNumber) {
  const result = await lookupVAT(vatNumber);
  return {
    valid: result.valid,
    error: result.error,
  };
}
