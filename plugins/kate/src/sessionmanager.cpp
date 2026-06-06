#include "sessionmanager.h"

#include <KWallet>

#include <QSettings>
#include <QStandardPaths>

#include <memory>

SessionManager::SessionManager(QObject *parent)
    : QObject(parent)
{
}

QString SessionManager::userKey() const
{
    using KWallet::Wallet;

    // 1. KWallet (preferred secure store).
    if (Wallet::isEnabled()) {
        std::unique_ptr<Wallet> wallet(
            Wallet::openWallet(Wallet::NetworkWallet(), 0, Wallet::Synchronous));
        if (wallet && wallet->isOpen()) {
            const QString folder = QStringLiteral("hadoku-task");
            if (wallet->hasFolder(folder) && wallet->setFolder(folder)) {
                QString value;
                if (wallet->readPassword(QStringLiteral("userKey"), value) == 0 && !value.isEmpty())
                    return value;
            }
        }
    }

    // 2. Dev fallback: <config>/hadoku-task.conf, [Auth] UserKey.
    const QString path =
        QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)
        + QStringLiteral("/hadoku-task.conf");
    QSettings settings(path, QSettings::IniFormat);
    return settings.value(QStringLiteral("Auth/UserKey")).toString();
}
