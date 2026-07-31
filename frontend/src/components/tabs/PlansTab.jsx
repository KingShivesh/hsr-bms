const PLANS = [
  {
    name: "Silver",
    monthlyPrice: 999,
    annualPrice: 9999,
    tableDiscountPercent: 5,
    cafeDiscountPercent: 5,
    freeHoursPerMonth: 1,
    activeMembersCount: 18,
    benefits: ["Priority booking window", "Member spending history", "Basic table discount"],
  },
  {
    name: "Gold",
    monthlyPrice: 1999,
    annualPrice: 19999,
    tableDiscountPercent: 10,
    cafeDiscountPercent: 8,
    freeHoursPerMonth: 3,
    activeMembersCount: 11,
    benefits: ["Priority booking", "Cafe discount", "Owner-visible VIP tag"],
    popularBadge: true,
  },
  {
    name: "Premium VIP",
    monthlyPrice: 3499,
    annualPrice: 34999,
    tableDiscountPercent: 15,
    cafeDiscountPercent: 12,
    freeHoursPerMonth: 6,
    activeMembersCount: 6,
    benefits: ["VIP lounge preference", "Highest priority", "Complimentary water"],
  },
];

export default function PlansTab() {
  const totalMembers = PLANS.reduce((sum, plan) => sum + plan.activeMembersCount, 0);
  const monthlyPotential = PLANS.reduce((sum, plan) => sum + plan.activeMembersCount * plan.monthlyPrice, 0);

  return (
    <div className="clubflow-page">
      <section className="clubflow-hero">
        <div>
          <span className="clubflow-eyebrow">Membership engine</span>
          <h2>Membership Plans</h2>
          <p>Configure tiers, benefits and member-facing loyalty economics.</p>
        </div>
        <div className="clubflow-hero-stats">
          <div>
            <strong>{totalMembers}</strong>
            <span>Members</span>
          </div>
          <div>
            <strong>₹{monthlyPotential.toLocaleString("en-IN")}</strong>
            <span>Monthly run-rate</span>
          </div>
        </div>
      </section>

      <div className="clubflow-card-grid plans">
        {PLANS.map((plan) => (
          <article className={`clubflow-plan ${plan.popularBadge ? "popular" : ""}`} key={plan.name}>
            {plan.popularBadge && <span className="clubflow-plan-badge">Most popular</span>}
            <div>
              <span className="clubflow-eyebrow">{plan.activeMembersCount} active</span>
              <h3>{plan.name}</h3>
              <p>₹{plan.monthlyPrice.toLocaleString("en-IN")} / month</p>
            </div>
            <div className="clubflow-plan-price">
              <strong>₹{plan.annualPrice.toLocaleString("en-IN")}</strong>
              <span>annual</span>
            </div>
            <div className="clubflow-mini-grid compact">
              <div>
                <span>Table</span>
                <strong>{plan.tableDiscountPercent}%</strong>
              </div>
              <div>
                <span>Cafe</span>
                <strong>{plan.cafeDiscountPercent}%</strong>
              </div>
              <div>
                <span>Free hrs</span>
                <strong>{plan.freeHoursPerMonth}</strong>
              </div>
            </div>
            <ul className="clubflow-benefits">
              {plan.benefits.map((benefit) => (
                <li key={benefit}>
                  <i className="ti ti-check" aria-hidden="true" />
                  {benefit}
                </li>
              ))}
            </ul>
            <button className="clubflow-secondary" type="button">
              Edit plan
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
