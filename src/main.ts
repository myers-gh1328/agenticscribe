import './styles.css';
import './notebook-app';

if ('serviceWorker' in navigator) {
	void navigator.serviceWorker.register('/sw.js');
}
