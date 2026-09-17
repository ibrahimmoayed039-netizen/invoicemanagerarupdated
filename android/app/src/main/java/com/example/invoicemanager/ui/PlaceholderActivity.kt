package com.example.invoicemanager.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.example.invoicemanager.databinding.ActivityPlaceholderBinding

/** شاشة مؤقتة للأقسام اللي لسا ما بنيناها كشاشة مستقلة — تُستبدل تدريجياً بشاشات فعلية،
 * أو تُستخدم لعرض رسالة توضيحية عند إعادة توجيه المستخدم لمكان آخر (كما بحال "التسديد"). */
class PlaceholderActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_TITLE = "extra_title"
        private const val EXTRA_MESSAGE = "extra_message"
        fun intentFor(context: Context, title: String, message: String? = null) =
            Intent(context, PlaceholderActivity::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_MESSAGE, message)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val binding = ActivityPlaceholderBinding.inflate(layoutInflater)
        setContentView(binding.root)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        val message = intent.getStringExtra(EXTRA_MESSAGE)
        binding.textPlaceholder.text = message ?: "شاشة \"$title\" — قريباً"
        supportActionBar?.title = title
    }
}
