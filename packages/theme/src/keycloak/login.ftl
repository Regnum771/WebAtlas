<#--
  WebATLAS sign-in form (K6). Adapted from Keycloak 26.4's base login.ftl. Differences:
  - a wrong email or password shows as one bordered alert above the fields (artboard 5), with both
    fields marked invalid and described by it, instead of an error line under the email field;
  - the password toggle is a short text button (Hiện / Ẩn) with aria-pressed, as in the WebATLAS dialog;
  - no registration, social or forgot-password blocks unless the realm turns them on.
-->
<#import "template.ftl" as layout>
<#import "passkeys.ftl" as passkeys>
<#assign credError = messagesPerField.existsError('username','password')>
<@layout.registrationLayout displayMessage=!credError displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <p class="wa-lead">${msg("waLoginLead")}</p>
        <#if realm.password>
            <form id="kc-form-login" class="wa-form" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate>
                <#if credError>
                    <div id="input-error" class="${properties.kcAlertClass!} wa-alert--error" role="alert">
                        <span class="wa-alert__title">${msg("waErrorTitle")}</span>
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</span>
                    </div>
                </#if>

                <#if !usernameHidden??>
                    <div class="${properties.kcFormGroupClass!}">
                        <label for="username" class="${properties.kcLabelClass!}"><#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if></label>
                        <input id="username" class="${properties.kcInputClass!}" name="username" value="${(login.username!'')}" type="text"
                               autofocus autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                               autocapitalize="none" spellcheck="false" dir="ltr"
                               <#if credError>aria-invalid="true" aria-describedby="input-error"</#if>
                        />
                    </div>
                </#if>

                <div class="${properties.kcFormGroupClass!}">
                    <label for="password" class="${properties.kcLabelClass!}">${msg("password")}</label>
                    <div class="${properties.kcInputGroup!}" dir="ltr">
                        <input id="password" class="${properties.kcInputClass!}" name="password" type="password" autocomplete="current-password"
                               <#if usernameHidden??>autofocus</#if>
                               <#if credError>aria-invalid="true" aria-describedby="input-error"</#if>
                        />
                        <button type="button" class="wa-toggle" aria-controls="password" aria-pressed="false" hidden
                                data-wa-reveal data-label-show="${msg("waShow")}" data-label-hide="${msg("waHide")}">${msg("waShow")}</button>
                    </div>
                </div>

                <#if (realm.rememberMe && !usernameHidden??) || realm.resetPasswordAllowed>
                    <div class="wa-options">
                        <#if realm.rememberMe && !usernameHidden??>
                            <label class="wa-check">
                                <input id="rememberMe" name="rememberMe" type="checkbox" class="wa-checkbox"<#if login.rememberMe??> checked</#if>>
                                <span>${msg("rememberMe")}</span>
                            </label>
                        </#if>
                        <#if realm.resetPasswordAllowed>
                            <a href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
                        </#if>
                    </div>
                </#if>

                <div id="kc-form-buttons" class="wa-actions">
                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <input class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                </div>
            </form>
            <script type="module">
                // The toggle stays hidden without JavaScript, where it could not work.
                const button = document.querySelector("[data-wa-reveal]");
                const input = document.getElementById("password");
                if (button && input) {
                    button.hidden = false;
                    button.addEventListener("click", () => {
                        const show = input.type === "password";
                        input.type = show ? "text" : "password";
                        button.setAttribute("aria-pressed", String(show));
                        button.textContent = show ? button.dataset.labelHide : button.dataset.labelShow;
                    });
                    // A submitted form never sends a password that is still on screen in clear text.
                    input.form?.addEventListener("submit", () => { input.type = "password"; });
                }
            </script>
        </#if>
        <@passkeys.conditionalUIData />
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <p id="kc-registration">${msg("noAccount")} <a href="${url.registrationUrl}">${msg("doRegister")}</a></p>
        </#if>
    <#elseif section = "socialProviders" >
        <#if realm.password && social?? && social.providers?has_content>
            <div id="kc-social-providers" class="wa-social">
                <p class="wa-divider">${msg("identity-provider-login-label")}</p>
                <ul>
                    <#list social.providers as p>
                        <li>
                            <a data-once-link data-disabled-class="wa-btn--disabled" id="social-${p.alias}" class="wa-btn wa-btn--secondary wa-btn--block" href="${p.loginUrl}">${p.displayName!}</a>
                        </li>
                    </#list>
                </ul>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
