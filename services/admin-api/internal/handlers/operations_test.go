package handlers

import "testing"

func TestClassifyOperation(t *testing.T) {
	cases := []struct {
		name        string
		host        string
		path        string
		method      string
		contentType string
		filename    string
		want        string
	}{
		{
			name: "outlook send mail", host: "outlook.office.com",
			path: "/owa/service.svc?action=SendMail", method: "POST",
			contentType: "application/json", want: OpEmailSent,
		},
		{
			name: "gmail send", host: "mail.google.com",
			path: "/mail/u/0/?ik=abc&at=xyz&view=up&act=sm", method: "POST",
			contentType: "application/x-www-form-urlencoded", want: OpEmailSent,
		},
		{
			name: "teams message", host: "teams.microsoft.com",
			path: "/api/chatsvc/v1/users/8:orgid/conversations/19:meeting/messages", method: "POST",
			contentType: "application/json", want: OpMessageSent,
		},
		{
			name: "slack message", host: "app.slack.com",
			path: "/api/chat.postMessage", method: "POST",
			contentType: "application/json", want: OpMessageSent,
		},
		{
			name: "drive upload", host: "www.googleapis.com",
			path: "/upload/drive/v3/files", method: "POST",
			contentType: "multipart/related", filename: "salaries.xlsx", want: OpFileUpload,
		},
		{
			name: "chatgpt prompt", host: "chatgpt.com",
			path: "/backend-api/conversation", method: "POST",
			contentType: "application/json", want: OpAIPrompt,
		},
		{
			// Teams host but not a messaging endpoint — must not claim "Message sent".
			name: "teams non-message upload", host: "teams.microsoft.com",
			path: "/api/mt/emea/beta/files", method: "POST",
			contentType: "multipart/form-data", filename: "notes.docx", want: OpFileUpload,
		},
		{
			name: "unknown host with file", host: "intranet.example.com",
			path: "/submit", method: "POST",
			contentType: "multipart/form-data", filename: "report.pdf", want: OpFileUpload,
		},
		{
			name: "unknown host plain form", host: "intranet.example.com",
			path: "/contact", method: "POST",
			contentType: "application/x-www-form-urlencoded", want: OpFormSubmit,
		},
		{
			name: "unknown host json", host: "api.vendor.io",
			path: "/v1/ingest", method: "POST",
			contentType: "application/json", want: OpDataSubmit,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := classifyOperation(c.host, c.path, c.method, c.contentType, c.filename)
			if got != c.want {
				t.Errorf("classifyOperation(%q, %q) = %q, want %q", c.host, c.path, got, c.want)
			}
		})
	}
}
