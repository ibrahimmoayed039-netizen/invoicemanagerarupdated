package com.example.invoicemanager.data

/**
 * يقابل صف واحد بقائمة المستحقات (getDuesSummary بنسخة سطح المكتب) — لكل عميل/مورّد
 * اتجاهان مستقلان: ما يدينون به لنا (من فواتير البيع + الرصيد القديم)، وما ندين نحن به
 * لهم (من فواتير الشراء)، كلٌّ بعملتيه (دينار/دولار).
 */
data class DuesRow(
    val customerId: String,
    val customerName: String,
    val theyOweUsIqd: Double,
    val theyOweUsUsd: Double,
    val weOweThemIqd: Double = 0.0,
    val weOweThemUsd: Double = 0.0,
)

data class DashboardSummary(
    val customersCount: Int,
    val saleInvoicesCount: Int,
    val purchaseInvoicesCount: Int,
    val totalSalesIqd: Double,
    val totalSalesUsd: Double,
    val totalPurchasesIqd: Double,
    val totalPurchasesUsd: Double,
    val totalDuesIqd: Double,
    val totalDuesUsd: Double,
    val totalWeOweIqd: Double,
    val totalWeOweUsd: Double,
)

/**
 * حسابات المستحقات ولوحة الملخص — تقابل getDuesSummary() وgetDashboardSummary() بنسخة سطح المكتب
 * (db.js)، بفارق أن نسخة أندرويد تحسب "الرصيد القديم المتبقي" من (الأصل − مجموع تسديدات الرصيد
 * القديم) بدل تعديل الحقل مباشرة. تشمل الآن فواتير الشراء (ما ندين به نحن للموردين) تماماً كنسخة
 * سطح المكتب — نفس جدول العملاء يُستخدم كعملاء وموردين معاً.
 */
object DuesCalculator {
    suspend fun computeDues(db: AppDatabase): List<DuesRow> {
        val customers = db.customerDao().getAllOnce()
        val saleInvoices = db.saleInvoiceDao().getAllOnce()
        val purchaseInvoices = db.purchaseInvoiceDao().getAllOnce()
        val payments = db.paymentDao().getAllOnce()
        val paymentsByCustomer = payments.groupBy { it.customerId }
        val saleInvoicesByCustomer = saleInvoices.groupBy { it.customerId }
        val purchaseInvoicesByCustomer = purchaseInvoices.groupBy { it.customerId }

        return customers.mapNotNull { c ->
            val custPayments = paymentsByCustomer[c.id] ?: emptyList()
            val paidOpeningIqd = custPayments.filter { it.kind == "opening_payment" && it.currency == "IQD" }.sumOf { it.amount }
            val paidOpeningUsd = custPayments.filter { it.kind == "opening_payment" && it.currency == "USD" }.sumOf { it.amount }
            val remOpeningIqd = (c.openingBalanceIqd - paidOpeningIqd).coerceAtLeast(0.0)
            val remOpeningUsd = (c.openingBalanceUsd - paidOpeningUsd).coerceAtLeast(0.0)

            val custSaleInvoices = saleInvoicesByCustomer[c.id] ?: emptyList()
            val remSaleIqd = custSaleInvoices.filter { it.currency == "IQD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }
            val remSaleUsd = custSaleInvoices.filter { it.currency == "USD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }

            val custPurchaseInvoices = purchaseInvoicesByCustomer[c.id] ?: emptyList()
            val remPurchaseIqd = custPurchaseInvoices.filter { it.currency == "IQD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }
            val remPurchaseUsd = custPurchaseInvoices.filter { it.currency == "USD" }.sumOf { (it.total - it.paidAmount).coerceAtLeast(0.0) }

            val theyOweUsIqd = remOpeningIqd + remSaleIqd
            val theyOweUsUsd = remOpeningUsd + remSaleUsd
            if (theyOweUsIqd > 0.0001 || theyOweUsUsd > 0.0001 || remPurchaseIqd > 0.0001 || remPurchaseUsd > 0.0001) {
                DuesRow(c.id, c.name, theyOweUsIqd, theyOweUsUsd, remPurchaseIqd, remPurchaseUsd)
            } else null
        }
    }

    suspend fun computeDashboard(db: AppDatabase): DashboardSummary {
        val saleInvoices = db.saleInvoiceDao().getAllOnce()
        val purchaseInvoices = db.purchaseInvoiceDao().getAllOnce()
        val customersCount = db.customerDao().getAllOnce().size
        val dues = computeDues(db)
        return DashboardSummary(
            customersCount = customersCount,
            saleInvoicesCount = saleInvoices.size,
            purchaseInvoicesCount = purchaseInvoices.size,
            totalSalesIqd = saleInvoices.filter { it.currency == "IQD" }.sumOf { it.total },
            totalSalesUsd = saleInvoices.filter { it.currency == "USD" }.sumOf { it.total },
            totalPurchasesIqd = purchaseInvoices.filter { it.currency == "IQD" }.sumOf { it.total },
            totalPurchasesUsd = purchaseInvoices.filter { it.currency == "USD" }.sumOf { it.total },
            totalDuesIqd = dues.sumOf { it.theyOweUsIqd },
            totalDuesUsd = dues.sumOf { it.theyOweUsUsd },
            totalWeOweIqd = dues.sumOf { it.weOweThemIqd },
            totalWeOweUsd = dues.sumOf { it.weOweThemUsd },
        )
    }
}
