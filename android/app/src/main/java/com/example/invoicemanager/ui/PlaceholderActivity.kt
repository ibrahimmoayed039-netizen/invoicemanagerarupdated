package com.example.invoicemanager.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.example.invoicemanager.databinding.ActivityPlaceholderBinding

/** شاشة مؤقتة للأقسام اللي لسا ما بنيناها (الفواتير، التسديد، الإعدادات) — تُستبدل تدريجياً بشاشات فعلية. */
class PlaceholderActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_TITLE = "extra_title"
        fun intentFor(context: Context, title: String) =
            Intent(context, PlaceholderActivity::class.java).putExtra(EXTRA_TITLE, title)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val binding = ActivityPlaceholderBinding.inflate(layoutInflater)
        setContentView(binding.root)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        binding.textPlaceholder.text = "شاشة \"$title\" — قريباً"
        supportActionBar?.title = title
    }
}
