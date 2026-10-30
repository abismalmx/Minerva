__license__ = 'AGPL v3'
__copyright__ = '2026, Bilingify LLC'

from qt.core import QMenu

from calibre.gui2 import error_dialog, info_dialog
from calibre.gui2.actions import InterfaceAction

from calibre_plugins.minerva.api import MinervaClient
from calibre_plugins.minerva.config import prefs, save_tokens
from calibre_plugins.minerva.dialogs import LoginDialog, PushDialog, StatusDialog
from calibre_plugins.minerva.wire import merge_marks

try:
    load_translations()
except NameError:
    pass


def make_client():
    return MinervaClient(
        api_base=prefs['api_base'],
        supabase_url=prefs['supabase_url'],
        tokens=prefs['tokens'],
        on_tokens=save_tokens,
    )


class MinervaInterfacePlugin(InterfaceAction):
    name = 'Minerva Sync'
    action_spec = (
        _('Minerva'),
        None,
        _('Push selected books and metadata to your Minerva library'),
        None,
    )

    def genesis(self):
        self.push_action = self.create_action(
            spec=(_('Push selected books to Minerva'), None, None, None),
            attr='Push selected books to Minerva',
        )
        self.push_action.triggered.connect(self.push_selected)

        self.check_action = self.create_action(
            spec=(_('Check Minerva status'), None, None, None),
            attr='Check Minerva status of selected books',
        )
        self.check_action.triggered.connect(self.check_selected)

        self.login_action = self.create_action(
            spec=(_('Log in to Minerva…'), None, None, None), attr='Log in to Minerva'
        )
        self.login_action.triggered.connect(self.login)

        self.logout_action = self.create_action(
            spec=(_('Log out'), None, None, None), attr='Log out from Minerva'
        )
        self.logout_action.triggered.connect(self.logout)

        self.config_action = self.create_action(
            spec=(_('Customize plugin…'), None, None, None), attr='Customize Minerva plugin'
        )
        self.config_action.triggered.connect(self.show_config)

        self.menu = QMenu(self.gui)
        self.menu.addAction(self.push_action)
        self.menu.addAction(self.check_action)
        self.menu.addSeparator()
        self.menu.addAction(self.login_action)
        self.menu.addAction(self.logout_action)
        self.menu.addAction(self.config_action)
        self.menu.aboutToShow.connect(self.update_menu)

        self.qaction.setMenu(self.menu)
        self.qaction.setIcon(get_icons('images/icon.png', 'Minerva Sync'))
        self.qaction.triggered.connect(self.push_selected)

    def update_menu(self):
        logged_in = bool(prefs['tokens'])
        email = prefs['user_email']
        self.login_action.setVisible(not logged_in)
        self.logout_action.setVisible(logged_in)
        if logged_in and email:
            self.logout_action.setText(_('Log out (%s)') % email)
        selected = len(self.selected_book_ids()) > 0
        self.push_action.setEnabled(selected)
        self.check_action.setEnabled(selected)

    def selected_book_ids(self):
        return self.gui.library_view.get_selected_ids()

    def push_selected(self):
        self.run_on_selection(PushDialog, _('Select the books to push to Minerva.'))

    def check_selected(self):
        self.run_on_selection(StatusDialog, _('Select the books to check against Minerva.'))

    def run_on_selection(self, dialog_class, no_selection_message):
        book_ids = self.selected_book_ids()
        if not book_ids:
            return error_dialog(
                self.gui, _('No books selected'), no_selection_message, show=True
            )
        if not prefs['tokens'] and not self.login():
            return
        dialog = dialog_class(
            self.gui,
            self.gui.current_db.new_api,
            book_ids,
            make_client(),
            bool(prefs['include_custom_columns']),
        )
        dialog.exec()
        self.apply_marks(dialog.marks)

    def apply_marks(self, marks):
        """Show the result in the book list as calibre marks (`marked:minerva_*`)."""
        if not marks:
            return
        view = self.gui.current_db.data
        # Repaint the rows we are marking plus the ones we are unmarking.
        touched = set(view.marked_ids) | set(marks)
        view.set_marked_ids(merge_marks(view.marked_ids, marks))
        self.gui.library_view.model().refresh_ids(sorted(touched))

    def login(self):
        dialog = LoginDialog(self.gui, make_client())
        if dialog.exec() != dialog.DialogCode.Accepted:
            return False
        user = dialog.user or {}
        prefs['user_email'] = user.get('email')
        info_dialog(
            self.gui,
            _('Minerva'),
            _('Logged in as %s.') % (user.get('email') or _('your Minerva account')),
            show=True,
        )
        return True

    def logout(self):
        try:
            make_client().sign_out()
        finally:
            save_tokens(None)

    def show_config(self):
        self.interface_action_base_plugin.do_user_config(self.gui)
