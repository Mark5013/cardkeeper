import mappingRepairPlan from "../../../scripts/data/tcgcsv-mapping-repairs-2026-07-25.json" with {
  type: "json",
};

const rebuildIdentityKeys = new Set(
  mappingRepairPlan.historyRebuildIdentities.map(
    (identity) => `${identity.cardProviderId}:${identity.printing}`,
  ),
);

export const TCGCSV_REPAIRED_HISTORY_TRUSTED_FROM =
  mappingRepairPlan.historyTrustedFrom;

export function isTcgcsvHistoryAwaitingRebuild(
  cardProviderId: string,
  printing: string,
) {
  return rebuildIdentityKeys.has(`${cardProviderId}:${printing}`);
}

export function isTrustedTcgcsvHistoryDay(
  cardProviderId: string,
  printing: string,
  observedOn: string,
) {
  return (
    !isTcgcsvHistoryAwaitingRebuild(cardProviderId, printing) ||
    observedOn >= TCGCSV_REPAIRED_HISTORY_TRUSTED_FROM
  );
}
