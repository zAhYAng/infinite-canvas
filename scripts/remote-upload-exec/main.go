package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type config struct {
	host       string
	port       int
	user       string
	keyPath    string
	localFile  string
	remoteFile string
	command    string
}

func main() {
	var cfg config
	flag.StringVar(&cfg.host, "host", "104.160.47.89", "SSH host")
	flag.IntVar(&cfg.port, "port", 22, "SSH port")
	flag.StringVar(&cfg.user, "user", "root", "SSH user")
	flag.StringVar(&cfg.keyPath, "key-path", "", "SSH private key path")
	flag.StringVar(&cfg.localFile, "local-file", "", "Local file to upload")
	flag.StringVar(&cfg.remoteFile, "remote-file", "", "Remote file path")
	flag.StringVar(&cfg.command, "command", "", "Remote command to run after upload")
	flag.Parse()

	if err := run(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(cfg config) error {
	if cfg.keyPath == "" {
		return fmt.Errorf("-key-path is required")
	}
	if cfg.command == "" {
		return fmt.Errorf("-command is required")
	}

	client, err := connectSSH(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	if cfg.localFile != "" {
		if cfg.remoteFile == "" {
			return fmt.Errorf("-remote-file is required when -local-file is set")
		}
		if err := uploadFile(client, cfg.localFile, cfg.remoteFile); err != nil {
			return err
		}
	}

	_, _, err = runRemoteCommand(client, cfg.command, true)
	return err
}

func connectSSH(cfg config) (*ssh.Client, error) {
	keyBytes, err := os.ReadFile(cfg.keyPath)
	if err != nil {
		return nil, err
	}
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err != nil {
		return nil, err
	}
	sshConfig := &ssh.ClientConfig{
		User:            cfg.user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         20 * time.Second,
	}
	return ssh.Dial("tcp", fmt.Sprintf("%s:%d", cfg.host, cfg.port), sshConfig)
}

func uploadFile(client *ssh.Client, localPath, remotePath string) error {
	file, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}

	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		return err
	}
	session.Stdout = os.Stdout
	session.Stderr = os.Stderr

	tempPath := remotePath + ".uploading"
	command := "mkdir -p " + shellQuote(filepath.ToSlash(filepath.Dir(remotePath))) +
		" && cat > " + shellQuote(tempPath) +
		" && mv " + shellQuote(tempPath) + " " + shellQuote(remotePath)
	if err := session.Start("bash -lc " + shellQuote(command)); err != nil {
		return err
	}

	_, copyErr := io.Copy(stdin, file)
	closeErr := stdin.Close()
	waitErr := session.Wait()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if waitErr != nil {
		return waitErr
	}
	fmt.Printf("uploaded %s (%d bytes) to %s\n", filepath.Base(localPath), info.Size(), remotePath)
	return nil
}

func runRemoteCommand(client *ssh.Client, command string, stream bool) (string, string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", "", err
	}
	defer session.Close()

	var stdoutBuf strings.Builder
	var stderrBuf strings.Builder
	if stream {
		session.Stdout = io.MultiWriter(os.Stdout, &stdoutBuf)
		session.Stderr = io.MultiWriter(os.Stderr, &stderrBuf)
	} else {
		session.Stdout = &stdoutBuf
		session.Stderr = &stderrBuf
	}

	err = session.Run("bash -lc " + shellQuote(command))
	return stdoutBuf.String(), stderrBuf.String(), err
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
