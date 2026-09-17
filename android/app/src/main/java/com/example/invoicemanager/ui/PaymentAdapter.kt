package com.example.invoicemanager.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.example.invoicemanager.data.Payment
import com.example.invoicemanager.databinding.ItemPaymentBinding
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class PaymentAdapter(
    private val customerNames: Map<String, String>,
    private val onLongClick: (Payment) -> Boolean,
) : ListAdapter<Payment, PaymentAdapter.VH>(DIFF) {

    class VH(val binding: ItemPaymentBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val binding = ItemPaymentBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return VH(binding)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val p = getItem(position)
        val nf = NumberFormat.getNumberInstance(Locale.US)
        val df = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
        val unit = if (p.currency == "USD") "$" else "د.ع"

        val kindLabel = when (p.kind) {
            "sale_payment" -> "تسديد فاتورة بيع (منه لنا)"
            "purchase_payment" -> "تسديد فاتورة شراء (منا له)"
            "opening_payment" -> "تسديد رصيد قديم"
            else -> p.kind
        }

        holder.binding.textCustomer.text = customerNames[p.customerId] ?: "عميل محذوف"
        holder.binding.textKind.text = kindLabel
        holder.binding.textAmount.text = "${nf.format(p.amount)} $unit"
        holder.binding.textDate.text = df.format(Date(p.date))

        holder.itemView.setOnLongClickListener { onLongClick(p) }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<Payment>() {
            override fun areItemsTheSame(a: Payment, b: Payment) = a.id == b.id
            override fun areContentsTheSame(a: Payment, b: Payment) = a == b
        }
    }
}
